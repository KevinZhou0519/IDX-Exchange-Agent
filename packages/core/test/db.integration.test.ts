// Runs against the local MySQL as the read-only agent user (corepack pnpm test:db).
// Skipped when the database is not reachable.
import { afterAll, describe, expect, it } from "vitest";
import {
  countListings,
  createDbCounter,
  createMemoryStore,
  loadVocabulary,
  showSoldComps,
  updateSearch,
  planNext,
  createDb,
  dbAvailable,
  activeByType,
  citySales,
  dataWindow,
  buildReport,
  type MarketSaleRow,
  facetCounts,
  formatPage,
  listingsPage,
  PAGE_SIZE,
  priceAt,
  soldComps,
  summarizeComps,
  type ListingRow,
  type ResolvedFilters,
  type SoldRow,
} from "../src/index.ts";

const db = createDb();
const available = await dbAvailable(db);
afterAll(() => db.close());

describe.skipIf(!available)("database access", () => {
  it("connects as the read-only user", async () => {
    const [row] = await db.query<{ user: string }>({ sql: "SELECT CURRENT_USER() AS user", params: [] });
    expect(row.user).toContain("idx_user@localhost");
  });

  it("cannot write", async () => {
    await expect(
      db.query({ sql: "UPDATE rets_property SET L_City = L_City WHERE id = -1", params: [] }),
    ).rejects.toThrow(/command denied/);
  });

  it("sold index exists", async () => {
    const rows = await db.query({
      sql: "SELECT INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'california_sold' AND INDEX_NAME = ?",
      params: ["idx_sold_city_date"],
    });
    expect(rows.length).toBeGreaterThan(0);
  });
});

const irvine = { values: ["Irvine"], input: "Irvine", match: "exact" as const, activeListings: 1 };
const handbookSearch: ResolvedFilters = {
  cities: [irvine],
  types: ["Condominium"],
  minBeds: 3,
  maxPrice: 1_500_000,
  pool: { value: true, priority: "must" },
  sources: {},
};

async function total(f: ResolvedFilters): Promise<number> {
  const [row] = await db.query<{ total: number | string }>(countListings(f));
  return Number(row.total);
}

describe.skipIf(!available)("search queries on the real data", () => {
  it("the handbook search finds homes, cheapest first", async () => {
    const found = await total(handbookSearch);
    expect(found).toBeGreaterThan(0);
    const rows = await db.query<ListingRow>(listingsPage(handbookSearch, 1));
    expect(rows).toHaveLength(Math.min(found, PAGE_SIZE));
    const prices = rows.map((r) => Number(r.L_SystemPrice));
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(formatPage(rows, 1, found)).toContain(", Irvine ");
  });

  it("a price limit narrows Irvine, and condos are the biggest type under it", async () => {
    const f: ResolvedFilters = { cities: [irvine], maxPrice: 1_200_000, sources: {} };
    const under = await total(f);
    expect(under).toBeGreaterThan(0);
    expect(under).toBeLessThan(await total({ cities: [irvine], sources: {} }));
    const types = await db.query<{ value: string; total: number | string }>(facetCounts(f, "type"));
    expect(types[0]).toMatchObject({ value: "Condominium" });
    expect(Number(types[0].total)).toBeGreaterThan(0);
    expect(Number(types[0].total)).toBeLessThanOrEqual(under);
  });

  it("reads a price at an offset", async () => {
    const all = await total({ cities: [irvine], sources: {} });
    const [row] = await db.query<{ price: number | string }>(priceAt({ cities: [irvine], sources: {} }, Math.floor(all / 2)));
    expect(Number(row.price)).toBeGreaterThan(0);
  });

  it("comps exclude future dates", async () => {
    const rows = await db.query<SoldRow>(soldComps({ sources: {} }));
    expect(rows.length).toBe(50);
    const today = new Date().toISOString().slice(0, 10);
    expect(rows.every((r) => (r.CloseDate ?? "") <= today)).toBe(true);
    expect(summarizeComps(rows).count).toBe(50);
  });
});

describe.skipIf(!available)("narrowing planner on the real data", () => {
  it("asks about the type for Irvine under $1.2M, condos first", async () => {
    const f: ResolvedFilters = { cities: [irvine], maxPrice: 1_200_000, sources: {} };
    const next = await planNext(f, createDbCounter(db));
    expect(next).toMatchObject({ action: "ask", total: await total(f), facet: "type" });
    const [top] = await db.query<{ value: string; total: number | string }>(facetCounts(f, "type"));
    expect(next.action === "ask" && next.options[0]).toEqual({ label: `Condominium (${top.total})`, total: Number(top.total) });
  });

  it("asks for a budget for all of Irvine, with real price points", async () => {
    const f: ResolvedFilters = { cities: [irvine], sources: {} };
    const next = await planNext(f, createDbCounter(db));
    expect(next).toMatchObject({ action: "ask", total: await total(f), facet: "price" });
    expect(next.action === "ask" && next.options).toHaveLength(3);
  });
});

describe.skipIf(!available)("handbook conversation on the real data", () => {
  it("narrows Irvine → budget → type and then shows cards", async () => {
    const deps = { store: createMemoryStore(), db, counter: createDbCounter(db), vocab: loadVocabulary() };
    const chat = "integration-chat";

    const first = await updateSearch(deps, chat, {
      text: "Find homes in Irvine",
      attempt: 1,
      cities: [{ value: "Irvine", evidence: "Irvine" }],
    });
    expect(first.next).toMatchObject({ action: "ask", facet: "price", total: await total({ cities: [irvine], sources: {} }) });

    const second = await updateSearch(deps, chat, {
      text: "Under $1.2M",
      attempt: 1,
      maxPrice: { value: 1_200_000, evidence: "Under $1.2M" },
    });
    expect(second.next).toMatchObject({
      action: "ask",
      facet: "type",
      total: await total({ cities: [irvine], maxPrice: 1_200_000, sources: {} }),
    });

    const third = await updateSearch(deps, chat, {
      text: "Single family with at least 3 beds",
      attempt: 1,
      types: [{ value: "SingleFamilyResidence", evidence: "Single family" }],
      minBeds: { value: 3, evidence: "at least 3 beds" },
    });
    expect(third.next?.action).toBe("show");
    expect(third.next && third.next.total).toBeLessThanOrEqual(20);
    expect(third.text).toContain("Irvine");
    expect(third.summary).toBe("3+ bed SingleFamilyResidence in Irvine, up to $1,200,000");

    const comps = await showSoldComps(deps, chat);
    expect(comps.summary?.count).toBeGreaterThan(0);
  });
});

describe.skipIf(!available)("market queries on the real data", () => {
  it("returns every Irvine sale with only the 8 market columns, none in the future", async () => {
    const started = performance.now();
    const rows = await db.query<MarketSaleRow>(citySales(["Irvine"]));
    expect(performance.now() - started).toBeLessThan(1000);
    expect(rows.length).toBeGreaterThan(1000);
    const today = new Date().toISOString().slice(0, 10);
    expect(rows.every((r) => r.CloseDate <= today)).toBe(true);
    expect(Object.keys(rows[0]).sort()).toEqual(
      ["CloseDate", "ClosePrice", "DaysOnMarket", "ListPrice", "LivingArea", "OriginalListPrice", "PostalCode", "PropertySubType"],
    );
    expect(typeof rows[0].ClosePrice).toBe("number");
  });

  it("uses the city/date index", async () => {
    const q = citySales(["Irvine"]);
    const [plan] = await db.query<{ key: string | null }>({ sql: `EXPLAIN ${q.sql}`, params: q.params });
    expect(plan.key).toBe("idx_sold_city_date");
  });

  it("active counts by type add up to the city's listing total", async () => {
    const rows = await db.query<{ type: string | null; total: number | string }>(activeByType(["Irvine"]));
    const sum = rows.reduce((n, r) => n + Number(r.total), 0);
    expect(sum).toBe(await total({ cities: [irvine], sources: {} }));
  });

  it("the data window ends no later than today", async () => {
    const [window] = await db.query<{ first: string; last: string }>(dataWindow());
    const today = new Date().toISOString().slice(0, 10);
    expect(window.first < window.last).toBe(true);
    expect(window.last <= today).toBe(true);
  });
});

describe.skipIf(!available)("market report on the real data", () => {
  it("a big city gets every section, with a trend and supply", async () => {
    const [window] = await db.query<{ first: string; last: string }>(dataWindow());
    const rows = await db.query<MarketSaleRow>(citySales(["Irvine"]));
    const active = await db.query<{ type: string | null; total: number }>(activeByType(["Irvine"]));
    const report = buildReport("Irvine", rows, active, window);
    expect(report.overall.sales).toBe(rows.length);
    expect(report.overall.medianSaleToListPct).toBeGreaterThan(90);
    expect(report.overall.medianSaleToListPct).toBeLessThan(110);
    expect(report.byType.length).toBeGreaterThan(1);
    expect(report.byZip.length).toBeGreaterThan(1);
    expect(report.byMonth.length).toBeGreaterThan(1);
    expect(report.change).not.toBeNull();
    expect(report.supply.monthsOfSupply).toBeGreaterThan(0);
  });
});
