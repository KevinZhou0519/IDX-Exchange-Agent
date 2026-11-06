import { describe, expect, it } from "vitest";
import {
  countListings,
  facetCounts,
  listingsPage,
  listingWhere,
  priceAt,
  soldComps,
  type ResolvedFilters,
} from "../src/index.ts";

const city = (...values: string[]) => ({ values, input: values[0], match: "exact" as const, activeListings: 1 });

const handbook: ResolvedFilters = {
  cities: [city("Irvine")],
  types: ["Condominium"],
  minBeds: 3,
  maxPrice: 1_500_000,
  pool: { value: true, priority: "must" },
  sources: {},
};

describe("listingWhere", () => {
  it("builds the handbook search", () => {
    const where = listingWhere(handbook);
    expect(where.sql).toBe(
      "L_City IN (?) AND L_SystemPrice <= ? AND L_Keyword2 >= ? AND L_Type_ IN (?) AND PoolPrivateYN = ?",
    );
    expect(where.params).toEqual(["Irvine", 1_500_000, 3, "Condominium", "1"]);
  });

  it("matches everything when there are no filters", () => {
    expect(listingWhere({ sources: {} })).toEqual({ sql: "1=1", params: [] });
  });

  it("nice-to-have pool does not filter", () => {
    expect(listingWhere({ pool: { value: true, priority: "nice" }, sources: {} }).sql).toBe("1=1");
  });

  it("no pool means not '1' or null", () => {
    const where = listingWhere({ pool: { value: false, priority: "must" }, sources: {} });
    expect(where.sql).toBe("(PoolPrivateYN IS NULL OR PoolPrivateYN <> ?)");
    expect(where.params).toEqual(["1"]);
  });

  it("empty HOA counts as zero", () => {
    expect(listingWhere({ maxHoa: 500, sources: {} })).toEqual({
      sql: "(AssociationFee IS NULL OR AssociationFee <= ?)",
      params: [500],
    });
  });

  it("excludes types", () => {
    expect(listingWhere({ excludeTypes: ["Condominium", "Townhouse"], sources: {} })).toEqual({
      sql: "(L_Type_ IS NULL OR L_Type_ NOT IN (?, ?))",
      params: ["Condominium", "Townhouse"],
    });
  });

  it("both spellings of one city", () => {
    const where = listingWhere({ cities: [city("29 Palms", "Twentynine Palms"), city("Irvine")], sources: {} });
    expect(where).toEqual({ sql: "L_City IN (?, ?, ?)", params: ["29 Palms", "Twentynine Palms", "Irvine"] });
  });

  it("user text never reaches SQL", () => {
    const attack = "Irvine'); DROP TABLE rets_property;--";
    const where = listingWhere({ cities: [city(attack)], sources: {} });
    expect(where.sql).not.toContain("DROP");
    expect(where.params).toEqual([attack]);
  });
});

describe("listing queries", () => {
  it("counts matches", () => {
    const q = countListings(handbook);
    expect(q.sql).toMatch(/^SELECT COUNT\(\*\) AS total FROM rets_property WHERE /);
    expect(q.params).toEqual(listingWhere(handbook).params);
  });

  it("pages are 5 long", () => {
    const q = listingsPage(handbook, 3);
    expect(q.sql).toMatch(/ORDER BY L_SystemPrice ASC, id ASC LIMIT \? OFFSET \?$/);
    expect(q.params.slice(-2)).toEqual([5, 10]);
  });

  it("counts by type, city and beds", () => {
    expect(facetCounts(handbook, "type").sql).toMatch(/GROUP BY L_Type_ ORDER BY total DESC$/);
    expect(facetCounts(handbook, "city").sql).toMatch(/GROUP BY L_City ORDER BY total DESC LIMIT 5$/);
    expect(facetCounts(handbook, "beds").sql).toMatch(/LEAST\(L_Keyword2, 5\)/);
  });

  it("reads one price at an offset", () => {
    const q = priceAt(handbook, 180);
    expect(q.sql).toMatch(/ORDER BY L_SystemPrice ASC LIMIT 1 OFFSET \?$/);
    expect(q.params.at(-1)).toBe(180);
  });
});

describe("soldComps", () => {
  it("uses the same cities, types and beds, a price cushion and no future dates", () => {
    const q = soldComps(handbook);
    expect(q.sql).toContain("City IN (?)");
    expect(q.sql).toContain("PropertySubType IN (?)");
    expect(q.sql).toContain("BedroomsTotal >= ?");
    expect(q.sql).toContain("ClosePrice <= ?");
    expect(q.sql).toContain("CloseDate <= CURDATE()");
    expect(q.sql).toMatch(/ORDER BY CloseDate DESC LIMIT \?$/);
    expect(q.params).toEqual(["Irvine", "Condominium", 3, 1_650_000, 50]);
  });
});
