// Decides the next step after a search changes: show cards when few match,
// otherwise ask about the most useful missing filter using real counts, or,
// when nothing matches, suggest which filter to loosen.
import type { Db } from "./db.ts";
import type { FilterField, ResolvedFilters } from "./filters.ts";
import { countListings, facetCounts, priceAt, type Facet } from "./sql.ts";

export const SHOW_MAX = 20;
const RELAX_SUGGESTIONS = 2;

export type FacetRow = { value: string | number; total: number };

export type Counter = {
  count(f: ResolvedFilters): Promise<number>;
  facet(f: ResolvedFilters, facet: "city" | "type" | "beds"): Promise<FacetRow[]>;
  priceQuartiles(f: ResolvedFilters, total: number): Promise<[number, number, number]>;
};

export type AskOption = { label: string; total?: number };

export type NextAction =
  | { action: "show"; total: number }
  | { action: "ask"; total: number; facet: Facet; options: AskOption[] }
  | { action: "relax"; total: 0; suggestions: { remove: FilterField; total: number }[] };

/** Filters that narrow the SQL search, in the order they are offered for loosening. */
const RELAXABLE: FilterField[] = [
  "maxPrice", "minPrice", "types", "excludeTypes", "minBeds", "minBaths", "minSqft", "pool", "view", "maxHoa",
];

const thousands = (n: number) => n.toLocaleString("en-US");
const withCount = (label: string, total: number): AskOption => ({ label: `${label} (${thousands(total)})`, total });

function isActive(f: ResolvedFilters, field: FilterField): boolean {
  const value = f[field as keyof ResolvedFilters];
  if (value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  // Nice-to-have pool/view are preferences, not filters.
  if (field === "pool" || field === "view") return (value as { priority: string }).priority === "must";
  return true;
}

export function withoutField(f: ResolvedFilters, field: FilterField): ResolvedFilters {
  const copy: ResolvedFilters = { ...f, sources: { ...f.sources } };
  delete copy[field as keyof ResolvedFilters];
  delete copy.sources[field];
  return copy;
}

async function askOptions(f: ResolvedFilters, facet: Facet, total: number, counter: Counter): Promise<AskOption[]> {
  if (facet === "price") {
    const points = [...new Set(await counter.priceQuartiles(f, total))];
    return points.map((price) => ({ label: `$${thousands(price)}` }));
  }
  const rows = await counter.facet(f, facet);
  return rows.map((row) =>
    facet === "beds" ? withCount(`${row.value}${Number(row.value) >= 5 ? "+" : ""} bd`, row.total) : withCount(String(row.value), row.total),
  );
}

/** The first unanswered question, in the order city → price → type → beds. */
function openFacets(f: ResolvedFilters): Facet[] {
  const open: Facet[] = [];
  if (!f.cities?.length) open.push("city");
  if (f.minPrice === undefined && f.maxPrice === undefined) open.push("price");
  if (!f.types?.length) open.push("type");
  if (f.minBeds === undefined) open.push("beds");
  return open;
}

export async function planNext(f: ResolvedFilters, counter: Counter): Promise<NextAction> {
  const total = await counter.count(f);
  if (total === 0) {
    // The city is the user's choice of place, never offered as something to drop.
    const candidates = RELAXABLE.filter((field) => isActive(f, field));
    const suggestions: { remove: FilterField; total: number }[] = [];
    for (const field of candidates) {
      const without = await counter.count(withoutField(f, field));
      if (without > 0) suggestions.push({ remove: field, total: without });
    }
    suggestions.sort((a, b) => b.total - a.total);
    return { action: "relax", total: 0, suggestions: suggestions.slice(0, RELAX_SUGGESTIONS) };
  }
  if (total <= SHOW_MAX) return { action: "show", total };
  for (const facet of openFacets(f)) {
    const options = await askOptions(f, facet, total, counter);
    if (options.length >= 2) return { action: "ask", total, facet, options };
  }
  return { action: "show", total };
}

/** A Counter backed by the real database. */
export function createDbCounter(db: Db): Counter {
  return {
    async count(f) {
      const [row] = await db.query<{ total: number | string }>(countListings(f));
      return Number(row?.total ?? 0);
    },
    async facet(f, facet) {
      const rows = await db.query<{ value: string | number; total: number | string }>(facetCounts(f, facet));
      return rows.map((row) => ({ value: row.value, total: Number(row.total) }));
    },
    async priceQuartiles(f, total) {
      const at = async (share: number) => {
        const [row] = await db.query<{ price: number | string }>(priceAt(f, Math.floor(total * share)));
        return Number(row?.price ?? 0);
      };
      return [await at(0.25), await at(0.5), await at(0.75)];
    },
  };
}
