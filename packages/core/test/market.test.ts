import { describe, expect, it } from "vitest";
import { buildReport, type MarketSaleRow } from "../src/index.ts";

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

  it("no trend when a full month at either end has under 10 sales", () => {
    const rows = [...many(10, { CloseDate: "2026-04-10" }), ...many(9, { CloseDate: "2026-08-10" })];
    const r = report(rows);
    expect(r.change).toBeNull();
    expect(r.notes.join(" ")).toMatch(/too few monthly sales/i);
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

  it("the report is aggregates only", () => {
    const r = report(many(30));
    expect(Object.keys(r).sort()).toEqual(["byMonth", "byType", "byZip", "change", "city", "notes", "overall", "supply", "window"]);
    expect(JSON.stringify(r)).not.toMatch(/ClosePrice|ListPrice|CloseDate/);
  });
});
