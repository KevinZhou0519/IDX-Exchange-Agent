// Runs against the local MySQL as the read-only agent user (corepack pnpm test:db).
// Skipped when the database is not reachable.
import { afterAll, describe, expect, it } from "vitest";
import { createDb, dbAvailable } from "../src/index.ts";

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
