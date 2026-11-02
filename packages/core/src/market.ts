// The market math: cleans a city's sales and turns them into a report of
// aggregates only. The model quotes these numbers; it never computes its own.
// marketReport() is the service behind the market_report tool.
import type { Db } from "./db.ts";
import { activeByType, citySales, dataWindow, type MarketSaleRow } from "./market-sql.ts";
import { matchCity } from "./match.ts";
import type { SearchDeps } from "./search.ts";

/** Sale ÷ asking outside this range is a typo (a price entered wrong), not a deal. */
export const RATIO_MIN = 0.5;
export const RATIO_MAX = 2.0;
/** A type, ZIP or month needs this many sales to be shown or used for a trend. */
export const MIN_GROUP_SALES = 10;
/** Below this, a city gets a note and no numbers. */
export const MIN_CITY_SALES = 5;
/** Below this, numbers come with a caution note. */
export const FEW_SALES = 30;
/** With at least this many full months, the same month a year apart is in the data. */
const YEAR_OVER_YEAR_MONTHS = 13;
/** A change smaller than this (in %) is "flat". */
export const FLAT_PCT = 2;
export const BALANCED_SUPPLY_MONTHS = 6;
/** One answer compares at most this many cities. */
export const MAX_CITIES = 3;

export type Stats = {
  sales: number;
  medianPrice: number | null;
  medianPricePerSqft: number | null;
  medianDaysOnMarket: number | null;
  medianSaleToListPct: number | null;
  soldOverAskingPct: number | null;
  soldAfterPriceCutPct: number | null;
};

export type Supply = { activeListings: number; salesPerMonth: number | null; monthsOfSupply: number | null };

export type Trend = { from: number; to: number; pct: number; direction: "up" | "down" | "flat" };

export type MonthStats = { month: string; partial: boolean } & Pick<
  Stats,
  "sales" | "medianPrice" | "medianPricePerSqft" | "medianDaysOnMarket"
>;

export type MarketReport = {
  city: string;
  window: { first: string; last: string };
  overall: Stats;
  byType: ({ type: string; supply: Supply } & Stats)[];
  byZip: ({ zip: string } & Stats)[];
  byMonth: MonthStats[];
  /** Each trend is null on its own when it cannot be computed; the whole change is null when none can. */
  change: { from: string; to: string; price: Trend | null; pricePerSqft: Trend | null; daysOnMarket: Trend | null } | null;
  supply: Supply;
  notes: string[];
};

type ActiveCount = { type: string | null; total: number | string };

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const round = (n: number, digits = 0) => Number(n.toFixed(digits));

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const share = (hits: number, of: number) => (of ? round((100 * hits) / of, 1) : null);
const positive = (n: number | null): n is number => n !== null && n > 0;

/** Sale ÷ asking for a sale, or null when it is missing or a typo. */
function saleToList(r: MarketSaleRow): number | null {
  if (!positive(r.ClosePrice) || !positive(r.ListPrice)) return null;
  const ratio = r.ClosePrice / r.ListPrice;
  return ratio >= RATIO_MIN && ratio <= RATIO_MAX ? ratio : null;
}

function priceStats(rows: MarketSaleRow[]) {
  const price = median(rows.map((r) => r.ClosePrice).filter(positive));
  const perSqft = median(rows.filter((r) => positive(r.ClosePrice) && positive(r.LivingArea)).map((r) => r.ClosePrice! / r.LivingArea!));
  const days = median(rows.map((r) => r.DaysOnMarket).filter((d): d is number => d !== null && d >= 0));
  return {
    medianPrice: price === null ? null : round(price),
    medianPricePerSqft: perSqft === null ? null : round(perSqft),
    medianDaysOnMarket: days === null ? null : round(days, 1),
  };
}

function stats(rows: MarketSaleRow[]): Stats {
  const ratios = rows.map(saleToList).filter((r): r is number => r !== null);
  const ratio = median(ratios);
  const withOriginal = rows.filter((r) => positive(r.ListPrice) && positive(r.OriginalListPrice));
  return {
    sales: rows.length,
    ...priceStats(rows),
    medianSaleToListPct: ratio === null ? null : round(ratio * 100, 1),
    soldOverAskingPct: share(ratios.filter((r) => r > 1).length, ratios.length),
    soldAfterPriceCutPct: share(withOriginal.filter((r) => r.ListPrice! < r.OriginalListPrice!).length, withOriginal.length),
  };
}

function groupBy(rows: MarketSaleRow[], key: (r: MarketSaleRow) => string | null): Map<string, MarketSaleRow[]> {
  const groups = new Map<string, MarketSaleRow[]>();
  for (const r of rows) {
    const k = key(r);
    if (!k) continue;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return groups;
}

/** Every month from the window's first to last, flagged when the data does not cover all of it. */
function windowMonths(window: { first: string; last: string }): { month: string; partial: boolean }[] {
  const firstMonth = window.first.slice(0, 7);
  const lastMonth = window.last.slice(0, 7);
  const [lastYear, lastMonthNumber] = lastMonth.split("-").map(Number);
  const daysInLastMonth = new Date(Date.UTC(lastYear, lastMonthNumber, 0)).getUTCDate();
  const months: { month: string; partial: boolean }[] = [];
  const cursor = new Date(`${firstMonth}-01T00:00:00Z`);
  for (let month = firstMonth; month <= lastMonth; month = cursor.toISOString().slice(0, 7)) {
    const startsLate = month === firstMonth && !window.first.endsWith("-01");
    const endsEarly = month === lastMonth && Number(window.last.slice(8, 10)) < daysInLastMonth;
    months.push({ month, partial: startsLate || endsEarly });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

function supplyOf(rows: MarketSaleRow[], activeListings: number, fullMonths: string[]): Supply {
  if (!fullMonths.length) return { activeListings, salesPerMonth: null, monthsOfSupply: null };
  const inFull = rows.filter((r) => fullMonths.includes(r.CloseDate.slice(0, 7))).length;
  const perMonth = inFull / fullMonths.length;
  return {
    activeListings,
    // "about 181 sales a month" reads better than 180.6, and leaves the model nothing to round.
    salesPerMonth: perMonth >= 10 ? Math.round(perMonth) : round(perMonth, 1),
    monthsOfSupply: perMonth ? round(activeListings / perMonth, 1) : null,
  };
}

function trend(from: number | null, to: number | null): Trend | null {
  if (from === null || to === null || from === 0) return null;
  const pct = round(((to - from) / from) * 100, 1);
  return { from, to, pct, direction: Math.abs(pct) < FLAT_PCT ? "flat" : pct > 0 ? "up" : "down" };
}

const monthName = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`;
const dateName = (date: string) => `${MONTH_NAMES[Number(date.slice(5, 7)) - 1]} ${Number(date.slice(8, 10))}, ${date.slice(0, 4)}`;

/** The full market report for one city. `active` is homes for sale now, by type. */
export function buildReport(
  city: string,
  rows: MarketSaleRow[],
  active: ActiveCount[],
  window: { first: string; last: string },
): MarketReport {
  const activeTotal = active.reduce((n, a) => n + Number(a.total), 0);
  const months = windowMonths(window);
  const fullMonths = months.filter((m) => !m.partial).map((m) => m.month);
  const partialMonths = months.filter((m) => m.partial).map((m) => monthName(m.month));
  const notes = [
    fullMonths.length >= YEAR_OVER_YEAR_MONTHS
      ? `Sales cover ${dateName(window.first)} to ${dateName(window.last)}.`
      : `Sales cover ${dateName(window.first)} to ${dateName(window.last)}; there is no 12-month or year-over-year data.`,
    ...(partialMonths.length ? [`Partial months: ${partialMonths.join(" and ")} (fewer days of data, so fewer sales).`] : []),
    "Homes for sale are a current snapshot; sales are from the period above.",
    "Monthly medians swing with the mix of condos and houses sold; describe the trend from the first to the last full month, not month by month.",
    `Months of supply: under about ${BALANCED_SUPPLY_MONTHS} months usually favors sellers, about ${BALANCED_SUPPLY_MONTHS} is balanced, over ${BALANCED_SUPPLY_MONTHS} favors buyers.`,
  ];

  if (rows.length < MIN_CITY_SALES) {
    const none = stats([]);
    return {
      city,
      window,
      overall: { ...none, sales: rows.length },
      byType: [],
      byZip: [],
      byMonth: [],
      change: null,
      supply: { activeListings: activeTotal, salesPerMonth: null, monthsOfSupply: null },
      notes: [`Only ${rows.length} sales in ${city} in this period, too few to describe its market.`, ...notes],
    };
  }
  if (rows.length < FEW_SALES) notes.unshift(`Only ${rows.length} sales in ${city} in this period; treat these numbers with caution.`);

  const activeByType = new Map(active.map((a) => [a.type, Number(a.total)]));
  const byType = [...groupBy(rows, (r) => r.PropertySubType)]
    .filter(([, group]) => group.length >= MIN_GROUP_SALES)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([type, group]) => ({ type, ...stats(group), supply: supplyOf(group, activeByType.get(type) ?? 0, fullMonths) }));
  // ZIP+4 codes ("90001-1234") count under their 5-digit ZIP.
  const byZip = [...groupBy(rows, (r) => r.PostalCode?.trim().slice(0, 5) || null)]
    .filter(([, group]) => group.length >= MIN_GROUP_SALES)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([zip, group]) => ({ zip, ...stats(group) }));

  const salesByMonth = groupBy(rows, (r) => r.CloseDate.slice(0, 7));
  const byMonth = months.map(({ month, partial }) => {
    const group = salesByMonth.get(month) ?? [];
    return { month, partial, sales: group.length, ...priceStats(group) };
  });

  let change: MarketReport["change"] = null;
  const [start, end] = [fullMonths[0], fullMonths.at(-1)];
  const startRows = salesByMonth.get(start) ?? [];
  const endRows = salesByMonth.get(end!) ?? [];
  if (start && end && start !== end && startRows.length >= MIN_GROUP_SALES && endRows.length >= MIN_GROUP_SALES) {
    const [a, b] = [priceStats(startRows), priceStats(endRows)];
    const price = trend(a.medianPrice, b.medianPrice);
    const pricePerSqft = trend(a.medianPricePerSqft, b.medianPricePerSqft);
    const daysOnMarket = trend(a.medianDaysOnMarket, b.medianDaysOnMarket);
    if (price || pricePerSqft || daysOnMarket) change = { from: start, to: end!, price, pricePerSqft, daysOnMarket };
  }
  if (!change) notes.push("Too few monthly sales to show a trend between the first and last full month.");

  return {
    city,
    window,
    overall: stats(rows),
    byType,
    byZip,
    byMonth,
    change,
    supply: supplyOf(rows, activeTotal, fullMonths),
    notes,
  };
}

export type CityIssue = { input: string; kind: "typo" | "unknown" | "ambiguous"; match?: string; candidates?: string[] };

export type MarketResult = {
  outcome: "ok" | "needs_confirmation" | "ambiguous" | "needs_city" | "needs_retry" | "too_many";
  reports: MarketReport[];
  issues: CityIssue[];
  instruction: string;
};

// The answer rules travel with every result: the model reads the tool result
// even when it has not opened the market-stats skill.
const ANSWER =
  "Answer the user's question using only numbers in `reports`: pick the ones that answer it, quote them as given " +
  "(rounding like $1,245,000 → $1.25M is fine) and pass on the relevant `notes`. Never calculate a number yourself, and add no facts from outside `reports`. " +
  "Format: for buy/sell advice or price predictions, start with \"I can't tell you whether to buy; this is market data, " +
  "not financial advice. Here's what it shows.\" With 4 or more bullets (comparisons too), put before the bullets, one sentence " +
  "starting \"In short:\". Then short bullets in plain words (\"buyers paid about 98% of the asking price\", \"homes took about " +
  "24 days to sell\"). Supply: \"<activeListings> homes are for sale now. At the current pace of about <salesPerMonth> " +
  "sales a month, it would take about <monthsOfSupply> months to sell them all.\" Any follow-up question last.";

const refuse = (outcome: "needs_city" | "needs_retry" | "too_many", instruction: string): MarketResult => ({
  outcome,
  reports: [],
  issues: [],
  instruction,
});

/** The sold data's date range never changes while the gateway runs, so it is read once per database. */
const windows = new WeakMap<Db, Promise<{ first: string; last: string }>>();
function windowOf(db: Db): Promise<{ first: string; last: string }> {
  let window = windows.get(db);
  if (!window) {
    window = db.query<{ first: string; last: string }>(dataWindow()).then(([row]) => row);
    windows.set(db, window);
    window.catch(() => windows.delete(db)); // a failed read is retried next time
  }
  return window;
}

/**
 * City names from the tool call, or the saved search's cities when none are
 * named (including a call with no arguments); null when the input is malformed.
 */
function requestedPlaces(deps: SearchDeps, sessionKey: string, input: unknown): string[] | { values: string[] }[] | null {
  if (input !== undefined && input !== null && typeof input !== "object") return null;
  const cities = (input as { cities?: unknown } | null | undefined)?.cities;
  if (cities === undefined || cities === null || (Array.isArray(cities) && cities.length === 0)) {
    return (deps.store.get(sessionKey)?.filters.cities ?? []).map((c) => ({ values: c.values }));
  }
  if (!Array.isArray(cities) || !cities.every((c) => typeof c === "string" && c.trim())) return null;
  return cities.map((c: string) => c.trim());
}

/**
 * Market reports for 1–3 cities named in the call, or for the city of this
 * chat's saved search when none is named.
 */
export async function marketReport(deps: SearchDeps, sessionKey: string, input: unknown): Promise<MarketResult> {
  const requested = requestedPlaces(deps, sessionKey, input);
  if (requested === null) {
    return refuse("needs_retry", 'Call market_report again with `cities` as a list of 1–3 city names, e.g. {"cities": ["Irvine"]}.');
  }
  if (requested.length === 0) {
    return refuse("needs_city", "Ask the user which city they want market numbers for. Do not call market_report until they name one.");
  }
  if (requested.length > MAX_CITIES) {
    return refuse("too_many", `market_report compares at most ${MAX_CITIES} cities. Ask the user which ${MAX_CITIES} to compare.`);
  }

  const places: string[][] = [];
  const issues: CityIssue[] = [];
  for (const place of requested) {
    if (typeof place !== "string") {
      places.push(place.values);
      continue;
    }
    const match = matchCity(place, deps.vocab);
    if ("values" in match) {
      places.push(match.values);
      if (match.kind === "fuzzy") issues.push({ input: place, kind: "typo", match: match.values[0] });
    } else {
      issues.push({ input: place, kind: match.kind === "none" ? "unknown" : "ambiguous", candidates: match.candidates.map((c) => c.value) });
    }
  }
  const unique = [...new Map(places.map((names) => [names.join("|"), names])).values()];

  const window = await windowOf(deps.db);
  const reports: MarketReport[] = [];
  for (const names of unique) {
    const [rows, active] = await Promise.all([
      deps.db.query<MarketSaleRow>(citySales(names)),
      deps.db.query<{ type: string | null; total: number }>(activeByType(names)),
    ]);
    reports.push(buildReport(names[0], rows, active, window));
  }

  const typos = issues.filter((i) => i.kind === "typo");
  const readCities = typos.length
    ? `First say how you read the city (${typos.map((i) => `"I read ${i.input} as ${i.match}"`).join(", ")}), then answer. `
    : "";
  if (typos.length < issues.length) {
    const others = reports.length ? ` You may answer for the other cities from \`reports\`. ${readCities}${ANSWER}` : "";
    return {
      outcome: "ambiguous",
      reports,
      issues,
      instruction: `Ask the user which city they meant, offering the \`candidates\` in \`issues\`.${others}`,
    };
  }
  if (typos.length) return { outcome: "needs_confirmation", reports, issues, instruction: readCities + ANSWER };
  return { outcome: "ok", reports, issues, instruction: ANSWER };
}
