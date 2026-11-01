import { createMemoryStore, type Counter, type Db, type ListingRow, type MarketSaleRow, type SearchDeps, type Sql } from "@idx/core";
import { fixtureVocab } from "../../core/test/fixtures/vocab.ts";

const row = (n: number): ListingRow => ({
  L_Address: `${n} Main St`, L_City: "Irvine", L_Zip: "92618", L_SystemPrice: 900_000 + n, L_Keyword2: 3,
  LM_Dec_3: "2.0", LM_Int2_3: 1500, AssociationFee: null, PoolPrivateYN: null, ViewYN: null, PhotoCount: 10,
  DaysOnMarket: 5, YearBuilt: 2000, L_DisplayId: String(n), PreviousListPrice: null, L_Remarks: null,
});

const sale = (n: number): MarketSaleRow => ({
  ClosePrice: 1_000_000 + n * 1000, ListPrice: 1_000_000, OriginalListPrice: 1_000_000, LivingArea: 1000,
  DaysOnMarket: 20, CloseDate: `2026-0${4 + (n % 5)}-10`, PostalCode: "92618", PropertySubType: "Condominium",
});

/** Search services with a pretend database holding `total` matching listings (and 40 sales for market reports). */
export function fakeDeps(total: number): SearchDeps & { queries: Sql[] } {
  const queries: Sql[] = [];
  const db: Db = {
    async query<T>(q: Sql) {
      queries.push(q);
      if (q.sql.includes("MIN(CloseDate)")) return [{ first: "2026-03-18", last: "2026-09-17" }] as T[];
      if (q.sql.includes("OriginalListPrice")) return Array.from({ length: 40 }, (_, i) => sale(i)) as T[];
      if (q.sql.includes("AS type, COUNT(*)")) return [{ type: "Condominium", total: 12 }] as T[];
      if (q.sql.includes("FROM california_sold")) return [] as T[];
      const offset = Number(q.params.at(-1));
      return Array.from({ length: total }, (_, i) => row(i + 1)).slice(offset, offset + 5) as T[];
    },
    close: async () => {},
  };
  const counter: Counter = {
    count: async () => total,
    facet: async () => [{ value: "Condominium", total: 163 }, { value: "Townhouse", total: 26 }],
    priceQuartiles: async () => [900_000, 1_250_000, 2_500_000],
  };
  return { store: createMemoryStore(), db, counter, vocab: fixtureVocab, queries };
}
