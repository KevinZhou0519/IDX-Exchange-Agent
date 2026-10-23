// Runs against the local MySQL as the read-only agent user (corepack pnpm test:db).
// Skipped when the database is not reachable.
import { afterAll, describe, expect, it } from "vitest";
import {
  countListings,
  createDb,
  dbAvailable,
  facetCounts,
  formatPage,
  listingsPage,
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

const irvine = { values: ["Irvine"], input: "Irvine", match: "exact" as const, activeListings: 723 };
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
  it("irvine handbook search finds 3", async () => {
    expect(await total(handbookSearch)).toBe(3);
    const rows = await db.query<ListingRow>(listingsPage(handbookSearch, 1));
    expect(rows.map((r) => r.L_Address)).toEqual(["10 Goldenbush", "57 Silverado", "108 Tribeca"]);
    expect(formatPage(rows, 1, 3)).toContain("1. 10 Goldenbush, Irvine 92604");
  });

  it("Irvine total is 723", async () => {
    expect(await total({ cities: [irvine], sources: {} })).toBe(723);
  });

  it("Irvine under 1.2M is 208 with 163 condos", async () => {
    const f: ResolvedFilters = { cities: [irvine], maxPrice: 1_200_000, sources: {} };
    expect(await total(f)).toBe(208);
    const types = await db.query<{ value: string; total: number | string }>(facetCounts(f, "type"));
    expect(types[0]).toMatchObject({ value: "Condominium" });
    expect(Number(types[0].total)).toBe(163);
  });

  it("reads a price at an offset", async () => {
    const [row] = await db.query<{ price: number | string }>(priceAt({ cities: [irvine], sources: {} }, 361));
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
