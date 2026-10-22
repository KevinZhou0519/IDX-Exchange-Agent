// Exports the dataset's real cities and property types (with listing counts)
// from MySQL into packages/core/data/vocab.json. The output is gitignored:
// it is derived from licensed MLS data.
//
// Usage: corepack pnpm vocab   (MYSQL_HOST / MYSQL_USER / MYSQL_PASSWORD / MYSQL_DATABASE override the defaults)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import mysql from "mysql2/promise";
import { DEFAULT_VOCAB_PATH, isPlaceholderCity, type Vocabulary } from "../packages/core/src/index.ts";

type CountRow = { name: string; n: number };

const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST ?? "localhost",
  user: process.env.MYSQL_USER ?? "root",
  password: process.env.MYSQL_PASSWORD ?? "",
  database: process.env.MYSQL_DATABASE ?? "idx_exchange",
});

async function counts(sql: string): Promise<CountRow[]> {
  const [rows] = await connection.query(sql);
  return (rows as { name: string; n: number | string }[]).map((row) => ({ name: row.name, n: Number(row.n) }));
}

try {
  const active = await counts(
    "SELECT L_City AS name, COUNT(*) AS n FROM rets_property WHERE L_City IS NOT NULL AND TRIM(L_City) <> '' GROUP BY L_City",
  );
  const sold = await counts(
    "SELECT City AS name, COUNT(*) AS n FROM california_sold WHERE City IS NOT NULL AND TRIM(City) <> '' GROUP BY City",
  );
  const types = await counts(
    "SELECT L_Type_ AS name, COUNT(*) AS n FROM rets_property WHERE L_Type_ IS NOT NULL AND TRIM(L_Type_) <> '' GROUP BY L_Type_",
  );

  const cities = new Map<string, { name: string; activeListings: number; soldCount: number }>();
  for (const { name, n } of active) {
    if (!isPlaceholderCity(name)) cities.set(name, { name, activeListings: n, soldCount: 0 });
  }
  for (const { name, n } of sold) {
    if (isPlaceholderCity(name)) continue;
    const city = cities.get(name) ?? { name, activeListings: 0, soldCount: 0 };
    city.soldCount = n;
    cities.set(name, city);
  }

  const vocab: Vocabulary = {
    generatedAt: new Date().toISOString(),
    cities: [...cities.values()].sort((a, b) => a.name.localeCompare(b.name)),
    types: types
      .map(({ name, n }) => ({ name, activeListings: n }))
      .sort((a, b) => b.activeListings - a.activeListings),
  };

  mkdirSync(dirname(DEFAULT_VOCAB_PATH), { recursive: true });
  writeFileSync(DEFAULT_VOCAB_PATH, JSON.stringify(vocab, null, 2) + "\n");
  const activeCities = vocab.cities.filter((city) => city.activeListings > 0).length;
  console.log(`cities: ${vocab.cities.length} (active ${activeCities}), types: ${vocab.types.length}`);
  console.log(`wrote ${DEFAULT_VOCAB_PATH}`);
} finally {
  await connection.end();
}
