// Turns database rows into WhatsApp-friendly text: listing cards, page
// headers and a sold-comps summary. mysql2 returns DECIMAL columns as
// strings, so numeric fields accept number | string | null.
import { PAGE_SIZE } from "./sql.ts";

type Num = number | string | null;

export type ListingRow = {
  L_Address: string | null;
  L_City: string | null;
  L_Zip: string | null;
  L_SystemPrice: Num;
  L_Keyword2: Num;
  LM_Dec_3: Num;
  LM_Int2_3: Num;
  AssociationFee: Num;
  PoolPrivateYN: string | null;
  ViewYN: string | null;
  PhotoCount: Num;
  DaysOnMarket: Num;
  YearBuilt: Num;
  L_DisplayId: string | null;
  PreviousListPrice: Num;
  L_Remarks: string | null;
};

export type SoldRow = {
  UnparsedAddress: string | null;
  City: string | null;
  CloseDate: string | null;
  ClosePrice: Num;
  LivingArea: Num;
  DaysOnMarket: Num;
  BedroomsTotal: Num;
  BathroomsTotalInteger: Num;
  PropertySubType: string | null;
};

export type CompsSummary = {
  count: number;
  medianPrice: number | null;
  medianPricePerSqft: number | null;
  avgDaysOnMarket: number | null;
  from: string | null;
  to: string | null;
  recent: SoldRow[];
};

export const REMARKS_CHARS = 150;
export const RECENT_SALES = 3;
const DASH = "—";

function num(value: Num): number | null {
  if (value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const dollars = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const count = (value: Num) => {
  const n = num(value);
  return n === null ? DASH : n.toLocaleString("en-US");
};

/** 3.0 → "3", 2.5 → "2.5". */
const baths = (value: Num) => {
  const n = num(value);
  return n === null ? DASH : String(n);
};

export function formatCard(row: ListingRow, n: number): string {
  const place = [row.L_Address ?? DASH, [row.L_City, row.L_Zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const price = num(row.L_SystemPrice);
  const previous = num(row.PreviousListPrice);
  const drop = price !== null && previous !== null && previous > price ? ` (↓ from ${dollars(previous)})` : "";
  const year = num(row.YearBuilt);
  const hoa = num(row.AssociationFee);
  const features = [row.PoolPrivateYN === "1" ? "Pool" : "", row.ViewYN === "1" ? "View" : ""].filter(Boolean);
  const lines = [
    `${n}. ${place}`,
    `   ${price === null ? DASH : dollars(price)}${drop}`,
    `   ${count(row.L_Keyword2)} bd / ${baths(row.LM_Dec_3)} ba · ${count(row.LM_Int2_3)} sq ft${year ? ` · built ${year}` : ""}`,
    `   ${[...features, hoa === null ? "No HOA listed" : `HOA ${dollars(hoa)}/mo`].join(" · ")}`,
    `   ${count(row.PhotoCount)} photos · ${count(row.DaysOnMarket)} days on market · MLS# ${row.L_DisplayId ?? DASH}`,
  ];
  const remarks = row.L_Remarks?.trim();
  if (remarks) {
    const short = remarks.length > REMARKS_CHARS ? `${remarks.slice(0, REMARKS_CHARS)}…` : remarks;
    lines.push(`   "${short}"`);
  }
  return lines.join("\n");
}

/** A page of cards under a "Showing a–b of total" header; numbering continues across pages. */
export function formatPage(rows: ListingRow[], page: number, total: number): string {
  const first = (page - 1) * PAGE_SIZE + 1;
  const last = Math.min(first + PAGE_SIZE - 1, total);
  const cards = rows.map((row, i) => formatCard(row, first + i));
  return [`Showing ${first}–${last} of ${total}`, ...cards].join("\n\n");
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function summarizeComps(rows: SoldRow[]): CompsSummary {
  const prices = rows.map((r) => num(r.ClosePrice)).filter((n): n is number => n !== null);
  const perSqft = rows.flatMap((r) => {
    const price = num(r.ClosePrice);
    const area = num(r.LivingArea);
    return price !== null && area !== null && area > 0 ? [price / area] : [];
  });
  const days = rows.map((r) => num(r.DaysOnMarket)).filter((n): n is number => n !== null);
  const dates = rows.map((r) => r.CloseDate).filter((d): d is string => Boolean(d)).sort();
  const newestFirst = [...rows].sort((a, b) => (b.CloseDate ?? "").localeCompare(a.CloseDate ?? ""));
  const medianPpsf = median(perSqft);
  return {
    count: rows.length,
    medianPrice: median(prices),
    medianPricePerSqft: medianPpsf === null ? null : Math.round(medianPpsf),
    avgDaysOnMarket: days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null,
    from: dates[0] ?? null,
    to: dates.at(-1) ?? null,
    recent: newestFirst.slice(0, RECENT_SALES),
  };
}

export function formatComps(s: CompsSummary, label: string): string {
  if (s.count === 0) return `No recent sales found for ${label}.`;
  const stats = [
    `${s.count} sale${s.count === 1 ? "" : "s"}`,
    s.medianPrice !== null ? `median ${dollars(s.medianPrice)}` : "",
    s.medianPricePerSqft !== null ? `${dollars(s.medianPricePerSqft)}/sq ft` : "",
    s.avgDaysOnMarket !== null ? `${s.avgDaysOnMarket} days on market` : "",
  ].filter(Boolean);
  const recent = s.recent.map((r) => {
    const price = num(r.ClosePrice);
    return `• ${r.UnparsedAddress ?? DASH} — ${price === null ? DASH : dollars(price)} · ${count(r.BedroomsTotal)} bd / ${count(r.BathroomsTotalInteger)} ba · sold ${r.CloseDate ?? DASH}`;
  });
  return [`Recently sold ${label} (${s.from} to ${s.to}): ${stats.join(" · ")}`, "Recent sales:", ...recent].join("\n");
}
