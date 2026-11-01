// The market math: cleans a city's sales and turns them into a report of
// aggregates only. The model quotes these numbers; it never computes its own.
import type { MarketSaleRow } from "./market-sql.ts";

/** Sale ÷ asking outside this range is a typo (a price entered wrong), not a deal. */
export const RATIO_MIN = 0.5;
export const RATIO_MAX = 2.0;
/** A type, ZIP or month needs this many sales to be shown or used for a trend. */
export const MIN_GROUP_SALES = 10;
/** Below this, a city gets a note and no numbers. */
export const MIN_CITY_SALES = 5;
/** Below this, numbers come with a caution note. */
export const FEW_SALES = 30;
/** A change smaller than this (in %) is "flat". */
export const FLAT_PCT = 2;
export const BALANCED_SUPPLY_MONTHS = 6;

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
  change: { from: string; to: string; price: Trend; pricePerSqft: Trend; daysOnMarket: Trend } | null;
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
    salesPerMonth: round(perMonth, 1),
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
    `Sales cover ${dateName(window.first)} to ${dateName(window.last)}; there is no 12-month or year-over-year data.`,
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
  const byZip = [...groupBy(rows, (r) => r.PostalCode?.trim() || null)]
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
    if (price && pricePerSqft && daysOnMarket) change = { from: start, to: end!, price, pricePerSqft, daysOnMarket };
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
