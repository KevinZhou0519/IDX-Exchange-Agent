// Turns a saved search into SQL for rets_property and california_sold.
// Table and column names are constants; every value is a ? parameter.
import type { Sql } from "./db.ts";
import type { Feature, ResolvedFilters } from "./filters.ts";

export const PAGE_SIZE = 5;
export const COMPS_LIMIT = 50;
/** Sold comps may close a little above the buyer's budget. */
const COMPS_PRICE_CUSHION = 1.1;

export type Facet = "city" | "price" | "type" | "beds";

/** The columns a property card shows. */
const LISTING_COLUMNS = [
  "L_Address", "L_City", "L_Zip", "L_SystemPrice", "L_Keyword2", "LM_Dec_3", "LM_Int2_3",
  "AssociationFee", "PoolPrivateYN", "ViewYN", "PhotoCount", "DaysOnMarket", "YearBuilt",
  "L_DisplayId", "PreviousListPrice", "L_Remarks",
].join(", ");

const SOLD_COLUMNS = [
  "UnparsedAddress", "City", "CloseDate", "ClosePrice", "LivingArea", "DaysOnMarket",
  "BedroomsTotal", "BathroomsTotalInteger", "PropertySubType",
].join(", ");

const placeholders = (n: number) => Array.from({ length: n }, () => "?").join(", ");

function featureCondition(column: string, feature: Feature | undefined, conditions: string[], params: Sql["params"]) {
  // A nice-to-have is a preference shown on cards, not a filter.
  if (!feature || feature.priority !== "must") return;
  conditions.push(feature.value ? `${column} = ?` : `(${column} IS NULL OR ${column} <> ?)`);
  params.push("1");
}

/** WHERE conditions for active listings, in a fixed order; "1=1" when there are none. */
export function listingWhere(f: ResolvedFilters): Sql {
  const conditions: string[] = [];
  const params: Sql["params"] = [];
  const cities = f.cities?.flatMap((c) => c.values) ?? [];
  if (cities.length) {
    conditions.push(`L_City IN (${placeholders(cities.length)})`);
    params.push(...cities);
  }
  const ranges: [number | undefined, string][] = [
    [f.minPrice, "L_SystemPrice >= ?"],
    [f.maxPrice, "L_SystemPrice <= ?"],
    [f.minBeds, "L_Keyword2 >= ?"],
    [f.minBaths, "LM_Dec_3 >= ?"],
    [f.minSqft, "LM_Int2_3 >= ?"],
  ];
  for (const [value, condition] of ranges) {
    if (value === undefined) continue;
    conditions.push(condition);
    params.push(value);
  }
  if (f.types?.length) {
    conditions.push(`L_Type_ IN (${placeholders(f.types.length)})`);
    params.push(...f.types);
  }
  if (f.excludeTypes?.length) {
    conditions.push(`(L_Type_ IS NULL OR L_Type_ NOT IN (${placeholders(f.excludeTypes.length)}))`);
    params.push(...f.excludeTypes);
  }
  featureCondition("PoolPrivateYN", f.pool, conditions, params);
  featureCondition("ViewYN", f.view, conditions, params);
  if (f.maxHoa !== undefined) {
    // An empty HOA means no HOA, which is under any maximum.
    conditions.push("(AssociationFee IS NULL OR AssociationFee <= ?)");
    params.push(f.maxHoa);
  }
  return { sql: conditions.length ? conditions.join(" AND ") : "1=1", params };
}

export function countListings(f: ResolvedFilters): Sql {
  const where = listingWhere(f);
  return { sql: `SELECT COUNT(*) AS total FROM rets_property WHERE ${where.sql}`, params: where.params };
}

/** One page of cards, cheapest first. Pages start at 1. */
export function listingsPage(f: ResolvedFilters, page: number): Sql {
  const where = listingWhere(f);
  return {
    sql: `SELECT ${LISTING_COLUMNS} FROM rets_property WHERE ${where.sql} ORDER BY L_SystemPrice ASC, id ASC LIMIT ? OFFSET ?`,
    params: [...where.params, PAGE_SIZE, (page - 1) * PAGE_SIZE],
  };
}

/** Match counts grouped by one facet, as rows of { value, total }. */
export function facetCounts(f: ResolvedFilters, facet: "city" | "type" | "beds"): Sql {
  const where = listingWhere(f);
  switch (facet) {
    case "city":
      return {
        sql: `SELECT L_City AS value, COUNT(*) AS total FROM rets_property WHERE ${where.sql} AND L_City IS NOT NULL GROUP BY L_City ORDER BY total DESC LIMIT 5`,
        params: where.params,
      };
    case "type":
      return {
        sql: `SELECT L_Type_ AS value, COUNT(*) AS total FROM rets_property WHERE ${where.sql} AND L_Type_ IS NOT NULL GROUP BY L_Type_ ORDER BY total DESC`,
        params: where.params,
      };
    case "beds":
      return {
        sql: `SELECT LEAST(L_Keyword2, 5) AS value, COUNT(*) AS total FROM rets_property WHERE ${where.sql} AND L_Keyword2 >= 1 GROUP BY value ORDER BY value`,
        params: where.params,
      };
  }
}

/** The list price at a position in price order (for quartiles). */
export function priceAt(f: ResolvedFilters, offset: number): Sql {
  const where = listingWhere(f);
  return {
    sql: `SELECT L_SystemPrice AS price FROM rets_property WHERE ${where.sql} AND L_SystemPrice IS NOT NULL ORDER BY L_SystemPrice ASC LIMIT 1 OFFSET ?`,
    params: [...where.params, offset],
  };
}

/** Recent sales comparable to the saved search, newest first. */
export function soldComps(f: ResolvedFilters): Sql {
  const conditions = ["CloseDate <= CURDATE()"];
  const params: Sql["params"] = [];
  const cities = f.cities?.flatMap((c) => c.values) ?? [];
  if (cities.length) {
    conditions.push(`City IN (${placeholders(cities.length)})`);
    params.push(...cities);
  }
  if (f.types?.length) {
    conditions.push(`PropertySubType IN (${placeholders(f.types.length)})`);
    params.push(...f.types);
  }
  if (f.minBeds !== undefined) {
    conditions.push("BedroomsTotal >= ?");
    params.push(f.minBeds);
  }
  if (f.maxPrice !== undefined) {
    conditions.push("ClosePrice <= ?");
    params.push(Math.round(f.maxPrice * COMPS_PRICE_CUSHION));
  }
  return {
    sql: `SELECT ${SOLD_COLUMNS} FROM california_sold WHERE ${conditions.join(" AND ")} ORDER BY CloseDate DESC LIMIT ?`,
    params: [...params, COMPS_LIMIT],
  };
}
