import { describe, expect, it } from "vitest";
import {
  buildReport,
  createMemoryStore,
  marketReport,
  type Db,
  type MarketSaleRow,
  type ResolvedFilters,
  type SearchDeps,
  type Sql,
} from "../src/index.ts";
import { fixtureVocab } from "./fixtures/vocab.ts";

const WINDOW = { first: "2026-03-18", last: "2026-09-17" };

const sale = (over: Partial<MarketSaleRow> = {}): MarketSaleRow => ({
  ClosePrice: 1_000_000,
  ListPrice: 1_000_000,
  OriginalListPrice: 1_000_000,
  LivingArea: 1000,
  DaysOnMarket: 20,
  CloseDate: "2026-05-10",
  PostalCode: "90001",
  PropertySubType: "Condominium",
  ...over,
});

const many = (n: number, over: Partial<MarketSaleRow> = {}) => Array.from({ length: n }, () => sale(over));
const prices = (...values: number[]) => values.map((ClosePrice) => sale({ ClosePrice, ListPrice: ClosePrice }));
const report = (rows: MarketSaleRow[], active: { type: string | null; total: number }[] = [], window = WINDOW) =>
  buildReport("Sampleton", rows, active, window);

describe("overall numbers", () => {
  it("medians of odd and even counts", () => {
    expect(report(prices(1e6, 5e6, 2e6, 4e6, 3e6)).overall.medianPrice).toBe(3_000_000);
    expect(report(prices(1e6, 2e6, 3e6, 4e6, 5e6, 6e6)).overall.medianPrice).toBe(3_500_000);
  });

  it("drops impossible sale/asking ratios from the ratio only", () => {
    const rows = [0.4, 2.5, 0.98, 1, 1.02].map((r) => sale({ ClosePrice: 1_000_000 * r, ListPrice: 1_000_000 }));
    const { overall } = report(rows);
    expect(overall.sales).toBe(5);
    expect(overall.medianPrice).toBe(1_000_000);
    expect(overall.medianSaleToListPct).toBe(100);
    expect(overall.soldOverAskingPct).toBe(33.3);
  });

  it("negative days and zero area are left out of those medians only", () => {
    const rows = [-5, 10, 20, 30, 40].map((DaysOnMarket, i) =>
      sale({ DaysOnMarket, ClosePrice: 1_000_000, LivingArea: i === 0 ? 0 : 1000 * (i + 1) }),
    );
    const { overall } = report(rows);
    expect(overall.medianDaysOnMarket).toBe(25);
    expect(overall.medianPricePerSqft).toBe(292); // $1M over 2,000–5,000 sq ft → 500, 333, 250, 200
    expect(overall.medianPrice).toBe(1_000_000);
  });

  it("over-asking and price-cut shares", () => {
    const rows = [
      sale({ ClosePrice: 1_050_000, ListPrice: 1_000_000 }),
      sale({ ListPrice: 900_000, OriginalListPrice: 1_000_000 }),
      sale({ ListPrice: 950_000, OriginalListPrice: 1_000_000 }),
      sale(),
      sale({ OriginalListPrice: null }),
    ];
    const { overall } = report(rows);
    expect(overall.soldOverAskingPct).toBe(60); // 1.05M over 1M, and 1M over the cut prices
    expect(overall.soldAfterPriceCutPct).toBe(50); // 2 of the 4 with an original price
  });
});

describe("breakdowns", () => {
  it("types and ZIPs under 10 sales are left out", () => {
    const rows = [
      ...many(12, { PropertySubType: "Condominium", PostalCode: "90001" }),
      ...many(9, { PropertySubType: "Townhouse", PostalCode: "90002" }),
      sale({ PropertySubType: null, PostalCode: null }),
    ];
    const r = report(rows, [{ type: "Condominium", total: 30 }, { type: "Townhouse", total: 5 }, { type: null, total: 2 }]);
    expect(r.byType.map((t) => [t.type, t.sales])).toEqual([["Condominium", 12]]);
    expect(r.byZip.map((z) => [z.zip, z.sales])).toEqual([["90001", 12]]);
    expect(r.supply.activeListings).toBe(37);
  });

  it("ZIP+4 codes count under their 5-digit ZIP", () => {
    const r = report([...many(6, { PostalCode: "90001" }), ...many(6, { PostalCode: "90001-1234" })]);
    expect(r.byZip.map((z) => [z.zip, z.sales])).toEqual([["90001", 12]]);
  });

  it("each type carries its own homes for sale and months of supply", () => {
    const fullMonths = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
    const rows = fullMonths.flatMap((m) => many(4, { CloseDate: `${m}-10` }));
    const [condo] = report(rows, [{ type: "Condominium", total: 16 }]).byType;
    expect(condo.supply).toEqual({ activeListings: 16, salesPerMonth: 4, monthsOfSupply: 4 });
  });
});

describe("months", () => {
  it("marks partial months from the window and keeps months without sales", () => {
    const r = report(many(5, { CloseDate: "2026-05-10" }));
    expect(r.byMonth.map((m) => [m.month, m.partial, m.sales])).toEqual([
      ["2026-03", true, 0],
      ["2026-04", false, 0],
      ["2026-05", false, 5],
      ["2026-06", false, 0],
      ["2026-07", false, 0],
      ["2026-08", false, 0],
      ["2026-09", true, 0],
    ]);
    const whole = report(many(5), [], { first: "2026-04-01", last: "2026-08-31" });
    expect(whole.byMonth.some((m) => m.partial)).toBe(false);
  });

  it("change uses the first and last full month", () => {
    const rows = [
      ...many(10, { CloseDate: "2026-03-20", ClosePrice: 3_000_000, ListPrice: 3_000_000 }), // partial month, ignored
      ...many(10, { CloseDate: "2026-04-10", ClosePrice: 1_000_000, DaysOnMarket: 20 }),
      ...many(10, { CloseDate: "2026-08-10", ClosePrice: 1_100_000, ListPrice: 1_100_000, DaysOnMarket: 20 }),
    ];
    const { change } = report(rows);
    expect(change).toMatchObject({ from: "2026-04", to: "2026-08" });
    expect(change!.price).toEqual({ from: 1_000_000, to: 1_100_000, pct: 10, direction: "up" });
    expect(change!.pricePerSqft).toEqual({ from: 1000, to: 1100, pct: 10, direction: "up" });
    expect(change!.daysOnMarket).toEqual({ from: 20, to: 20, pct: 0, direction: "flat" });
  });

  it("a change under 2% is flat", () => {
    const rows = [
      ...many(10, { CloseDate: "2026-04-10", ClosePrice: 1_000_000 }),
      ...many(10, { CloseDate: "2026-08-10", ClosePrice: 985_000 }),
    ];
    expect(report(rows).change!.price).toMatchObject({ pct: -1.5, direction: "flat" });
  });

  it("a trend that cannot be computed is left out on its own", () => {
    const rows = [
      ...many(10, { CloseDate: "2026-04-10", DaysOnMarket: 0 }),
      ...many(10, { CloseDate: "2026-08-10", ClosePrice: 1_100_000, ListPrice: 1_100_000, DaysOnMarket: 20 }),
    ];
    const r = report(rows);
    expect(r.change!.price).toMatchObject({ pct: 10, direction: "up" });
    expect(r.change!.daysOnMarket).toBeNull();
    expect(r.notes.join(" ")).not.toMatch(/too few monthly sales/i);
  });

  it("no trend when a full month at either end has under 10 sales", () => {
    const rows = [...many(10, { CloseDate: "2026-04-10" }), ...many(9, { CloseDate: "2026-08-10" })];
    const r = report(rows);
    expect(r.change).toBeNull();
    expect(r.notes.join(" ")).toMatch(/too few monthly sales/i);
  });

  it("a pace of 10 or more sales a month is a whole number; months of supply uses the exact pace", () => {
    const rows = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"].flatMap((m, i) => many(i < 3 ? 12 : 11, { CloseDate: `${m}-10` }));
    expect(report(rows, [{ type: "Condominium", total: 46 }]).supply).toEqual({ activeListings: 46, salesPerMonth: 12, monthsOfSupply: 4 });
  });

  it("months of supply from full-month sales", () => {
    const rows = [
      ...many(50, { CloseDate: "2026-03-20" }), // partial month: not counted in the pace
      ...["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"].flatMap((m) => many(10, { CloseDate: `${m}-10` })),
    ];
    expect(report(rows, [{ type: "Condominium", total: 40 }]).supply).toEqual({
      activeListings: 40,
      salesPerMonth: 10,
      monthsOfSupply: 4,
    });
  });
});

describe("notes and small cities", () => {
  it("under 5 sales gives only a note", () => {
    const r = report(many(4), [{ type: "Condominium", total: 3 }]);
    expect(r.overall).toEqual({
      sales: 4,
      medianPrice: null,
      medianPricePerSqft: null,
      medianDaysOnMarket: null,
      medianSaleToListPct: null,
      soldOverAskingPct: null,
      soldAfterPriceCutPct: null,
    });
    expect(r.byType).toEqual([]);
    expect(r.byZip).toEqual([]);
    expect(r.byMonth).toEqual([]);
    expect(r.change).toBeNull();
    expect(r.supply).toEqual({ activeListings: 3, salesPerMonth: null, monthsOfSupply: null });
    expect(r.notes.join(" ")).toMatch(/only 4 sales.*too few/i);
  });

  it("under 30 sales adds the few-sales note", () => {
    expect(report(many(29)).notes.join(" ")).toMatch(/only 29 sales.*caution/i);
    expect(report(many(30)).notes.join(" ")).not.toMatch(/caution/i);
  });

  it("always carries the window, snapshot, mix and supply rule-of-thumb notes", () => {
    const notes = report(many(30)).notes.join("\n");
    expect(notes).toContain("March 18, 2026 to September 17, 2026");
    expect(notes).toMatch(/no 12-month or year-over-year/);
    expect(notes).toMatch(/current snapshot/);
    expect(notes).toMatch(/mix of/);
    expect(notes).toMatch(/under about 6 months usually favors sellers/);
    expect(notes).toMatch(/partial months: March 2026 and September 2026/i);
  });

  it("does not claim there is no 12-month data when the window has 13 full months or more", () => {
    const notes = report(many(30), [], { first: "2025-01-01", last: "2026-08-31" }).notes.join("\n");
    expect(notes).toContain("January 1, 2025 to August 31, 2026");
    expect(notes).not.toMatch(/no 12-month/);
  });

  it("the report is aggregates only", () => {
    const r = report(many(30));
    expect(Object.keys(r).sort()).toEqual(["byMonth", "byType", "byZip", "change", "city", "notes", "overall", "supply", "window"]);
    expect(JSON.stringify(r)).not.toMatch(/ClosePrice|ListPrice|CloseDate/);
  });
});

/** Services with a pretend database: 40 sales and 12 homes for sale in every place. */
function marketDeps() {
  const queries: Sql[] = [];
  const db: Db = {
    async query<T>(q: Sql) {
      queries.push(q);
      if (q.sql.includes("MIN(CloseDate)")) return [WINDOW] as T[];
      if (q.sql.includes("FROM california_sold")) return many(40) as T[];
      if (q.sql.includes("FROM rets_property")) return [{ type: "Condominium", total: 12 }] as T[];
      throw new Error(`unexpected query: ${q.sql}`);
    },
    close: async () => {},
  };
  const deps: SearchDeps = {
    store: createMemoryStore(),
    db,
    counter: { count: async () => 0, facet: async () => [], priceQuartiles: async () => [0, 0, 0] },
    vocab: fixtureVocab,
  };
  return { deps, queries, salesQueries: () => queries.filter((q) => q.sql.includes("OriginalListPrice")) };
}

const savedIn = (city: string): ResolvedFilters => ({
  cities: [{ values: [city], input: city, match: "exact", activeListings: 100 }],
  sources: {},
});

describe("marketReport", () => {
  it("one exact city gives one report and an answer instruction", async () => {
    const { deps } = marketDeps();
    const result = await marketReport(deps, "chat", { cities: ["Irvine"] });
    expect(result.outcome).toBe("ok");
    expect(result.reports.map((r) => r.city)).toEqual(["Irvine"]);
    expect(result.reports[0].overall.sales).toBe(40);
    expect(result.issues).toEqual([]);
    expect(result.instruction).toMatch(/only numbers in `reports`/);
    expect(result.instruction).toMatch(/before the bullets, one sentence starting "In short:"/);
    expect(result.instruction).toMatch(/no facts from outside `reports`/);
    expect(result.instruction).toMatch(/homes are for sale now\. At the current pace/);
    expect(result.instruction).toMatch(/question last/);
  });

  it("both spellings of a place go into one report", async () => {
    const { deps, salesQueries } = marketDeps();
    const result = await marketReport(deps, "chat", { cities: ["29 Palms"] });
    expect(result.reports).toHaveLength(1);
    expect(salesQueries()[0].params).toEqual(["29 Palms", "Twentynine Palms"]);
  });

  it("three cities give three reports; a fourth is refused before any query", async () => {
    const { deps, queries } = marketDeps();
    const three = await marketReport(deps, "chat", { cities: ["Irvine", "Tustin", "Orange"] });
    expect(three.reports.map((r) => r.city)).toEqual(["Irvine", "Tustin", "Orange"]);
    queries.length = 0;
    const four = await marketReport(deps, "chat", { cities: ["Irvine", "Tustin", "Orange", "Pasadena"] });
    expect(four).toMatchObject({ outcome: "too_many", reports: [] });
    expect(four.instruction).toMatch(/at most 3/);
    expect(queries).toEqual([]);
  });

  it("the same city twice gives one report", async () => {
    const { deps } = marketDeps();
    expect((await marketReport(deps, "chat", { cities: ["Irvine", "irvine"] })).reports).toHaveLength(1);
  });

  it("a typo gives needs_confirmation with the match and still a report", async () => {
    const { deps } = marketDeps();
    const result = await marketReport(deps, "chat", { cities: ["Irivine"] });
    expect(result.outcome).toBe("needs_confirmation");
    expect(result.issues).toEqual([{ input: "Irivine", kind: "typo", match: "Irvine" }]);
    expect(result.reports.map((r) => r.city)).toEqual(["Irvine"]);
    expect(result.instruction).toMatch(/I read Irivine as Irvine/);
  });

  it("an unknown city is ambiguous with candidates; other cities still get reports", async () => {
    const { deps } = marketDeps();
    const result = await marketReport(deps, "chat", { cities: ["Atlantis", "Tustin"] });
    expect(result.outcome).toBe("ambiguous");
    expect(result.issues).toMatchObject([{ input: "Atlantis", kind: "unknown" }]);
    expect(result.issues[0].candidates!.length).toBeGreaterThan(0);
    expect(result.reports.map((r) => r.city)).toEqual(["Tustin"]);
    expect(result.instruction).toMatch(/which city/);
  });

  it("a typo next to an unknown city still asks to say how the typo was read", async () => {
    const { deps } = marketDeps();
    const result = await marketReport(deps, "chat", { cities: ["Irivine", "Atlantis"] });
    expect(result.outcome).toBe("ambiguous");
    expect(result.instruction).toMatch(/which city/);
    expect(result.instruction).toMatch(/I read Irivine as Irvine/);
  });

  it("no city uses the saved search's city", async () => {
    const { deps } = marketDeps();
    deps.store.save("chat", savedIn("Pasadena"));
    for (const input of [{}, { cities: [] }, { cities: null }, null, undefined]) {
      const result = await marketReport(deps, "chat", input);
      expect(result).toMatchObject({ outcome: "ok" });
      expect(result.reports.map((r) => r.city)).toEqual(["Pasadena"]);
    }
  });

  it("no city and no saved search asks for a city", async () => {
    const { deps, queries } = marketDeps();
    const result = await marketReport(deps, "chat", {});
    expect(result).toMatchObject({ outcome: "needs_city", reports: [], issues: [] });
    expect(result.instruction).toMatch(/Ask the user which city/);
    expect(queries).toEqual([]);
  });

  it("malformed cities ask for a retry before any query", async () => {
    const { deps, queries } = marketDeps();
    for (const input of [{ cities: "Irvine" }, { cities: [7] }, { cities: [" "] }, "Irvine", 7]) {
      const result = await marketReport(deps, "chat", input);
      expect(result).toMatchObject({ outcome: "needs_retry", reports: [] });
      expect(result.instruction).toMatch(/list of 1–3 city names/);
    }
    expect(queries).toEqual([]);
  });

  it("reads the data window once per database", async () => {
    const { deps, queries } = marketDeps();
    await marketReport(deps, "chat", { cities: ["Irvine"] });
    await marketReport(deps, "chat", { cities: ["Tustin"] });
    expect(queries.filter((q) => q.sql.includes("MIN(CloseDate)"))).toHaveLength(1);
  });
});
