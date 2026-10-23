import { describe, expect, it } from "vitest";
import {
  createMemoryStore,
  showListings,
  showSoldComps,
  updateSearch,
  type Counter,
  type Db,
  type ListingRow,
  type SearchDeps,
  type Sql,
  type SoldRow,
} from "../src/index.ts";
import { fixtureVocab } from "./fixtures/vocab.ts";

const listing = (address: string, price: number): ListingRow => ({
  L_Address: address,
  L_City: "Irvine",
  L_Zip: "92618",
  L_SystemPrice: price,
  L_Keyword2: 3,
  LM_Dec_3: "2.0",
  LM_Int2_3: 1500,
  AssociationFee: null,
  PoolPrivateYN: null,
  ViewYN: null,
  PhotoCount: 10,
  DaysOnMarket: 5,
  YearBuilt: 2000,
  L_DisplayId: "1",
  PreviousListPrice: null,
  L_Remarks: null,
});

const sale: SoldRow = {
  UnparsedAddress: "1 Sold Way",
  City: "Irvine",
  CloseDate: "2026-09-01",
  ClosePrice: 1_100_000,
  LivingArea: 1100,
  DaysOnMarket: 20,
  BedroomsTotal: 3,
  BathroomsTotalInteger: 2,
  PropertySubType: "Condominium",
};

/** Pretend services: `total` matches; the db records every query it receives. */
function deps(total: number) {
  const queries: Sql[] = [];
  const db: Db = {
    async query<T>(q: Sql) {
      queries.push(q);
      if (q.sql.includes("FROM california_sold")) return [sale] as T[];
      const offset = Number(q.params.at(-1));
      const rows = Array.from({ length: total }, (_, i) => listing(`${i + 1} Main St`, 900_000 + i));
      return rows.slice(offset, offset + 5) as T[];
    },
    close: async () => {},
  };
  const counter: Counter = {
    count: async () => total,
    facet: async () => [
      { value: "Condominium", total: 163 },
      { value: "Townhouse", total: 26 },
    ],
    priceQuartiles: async () => [900_000, 1_250_000, 2_500_000],
  };
  const d: SearchDeps = { store: createMemoryStore(), db, counter, vocab: fixtureVocab };
  return { deps: d, queries };
}

const irvine = { value: "Irvine", evidence: "Irvine" };

describe("updateSearch", () => {
  it("first message saves and plans", async () => {
    const { deps: d } = deps(723);
    const result = await updateSearch(d, "chat-a", { text: "homes in Irvine", attempt: 1, cities: [irvine] });
    expect(result.outcome).toBe("ok");
    expect(result.saved.cities?.[0].values).toEqual(["Irvine"]);
    expect(d.store.get("chat-a")?.filters.cities?.[0].values).toEqual(["Irvine"]);
    expect(result.next).toMatchObject({ action: "ask", facet: "price", total: 723 });
  });

  it("follow-up keeps earlier filters", async () => {
    const { deps: d } = deps(208);
    await updateSearch(d, "chat-a", { text: "homes in Irvine", attempt: 1, cities: [irvine] });
    const result = await updateSearch(d, "chat-a", {
      text: "under $1.2M",
      attempt: 1,
      maxPrice: { value: 1_200_000, evidence: "under $1.2M" },
    });
    expect(result.saved.cities?.[0].values).toEqual(["Irvine"]);
    expect(result.saved.maxPrice).toBe(1_200_000);
    expect(result.summary).toBe("home in Irvine, up to $1,200,000");
  });

  it("fields with issues are not saved", async () => {
    const { deps: d } = deps(50);
    const result = await updateSearch(d, "chat-a", {
      text: "homes in Gotham under $1.2M",
      attempt: 1,
      cities: [{ value: "Gotham", evidence: "Gotham" }],
      maxPrice: { value: 1_200_000, evidence: "under $1.2M" },
    });
    expect(result.outcome).toBe("needs_retry");
    expect(result.saved.cities).toBeUndefined();
    expect(result.saved.maxPrice).toBe(1_200_000);
    expect(result.next).toBeUndefined();
  });

  it("shows cards when few match", async () => {
    const { deps: d } = deps(3);
    const result = await updateSearch(d, "chat-a", { text: "homes in Irvine", attempt: 1, cities: [irvine] });
    expect(result.next).toEqual({ action: "show", total: 3 });
    expect(result.text?.startsWith("Showing 1–3 of 3")).toBe(true);
  });

  it("keeps chats apart", async () => {
    const { deps: d } = deps(723);
    await updateSearch(d, "chat-a", { text: "homes in Irvine", attempt: 1, cities: [irvine] });
    const other = await updateSearch(d, "chat-b", { text: "3 beds", attempt: 1, minBeds: { value: 3, evidence: "3 beds" } });
    expect(other.saved.cities).toBeUndefined();
  });
});

describe("input validation", () => {
  it("rejects unknown field names with the list of real ones, saving nothing", async () => {
    const { deps: d } = deps(50);
    const result = await updateSearch(d, "chat-a", {
      text: "Condos in Irvine",
      attempt: 1,
      cities: [irvine],
      propertyTypes: [{ value: "condo", evidence: "Condos" }],
    } as never);
    expect(result.outcome).toBe("needs_retry");
    expect(result.issues).toEqual([expect.objectContaining({ field: "propertyTypes", kind: "invalid_field" })]);
    expect(result.issues[0].message).toContain("types");
    expect(d.store.get("chat-a")).toBeUndefined();
    expect(result.next).toBeUndefined();
  });

  it("asks the user after a second invalid attempt", async () => {
    const { deps: d } = deps(50);
    const result = await updateSearch(d, "chat-a", { text: "Condos", attempt: 2, propertyTypes: [] } as never);
    expect(result.outcome).toBe("ambiguous");
  });

  it("rejects a value in the wrong format", async () => {
    const { deps: d } = deps(50);
    const result = await updateSearch(d, "chat-a", {
      text: "condo in Irvine",
      attempt: 1,
      types: [{ value: "condo", evidence: "condo" }],
    } as never);
    expect(result.outcome).toBe("needs_retry");
    expect(result.issues[0]).toMatchObject({ field: "types", kind: "invalid_field" });
  });
});

describe("checking against the real message", () => {
  it("checks quotes against the real message when one is known", async () => {
    const { deps: d } = deps(50);
    const result = await updateSearch(
      d,
      "chat-a",
      { text: "homes in Irvine under $2M", attempt: 1, cities: [irvine], maxPrice: { value: 2_000_000, evidence: "under $2M" } },
      "homes in Irvine under $1.5M",
    );
    expect(result.outcome).toBe("needs_retry");
    expect(result.issues).toEqual([expect.objectContaining({ field: "maxPrice", kind: "evidence_mismatch" })]);
    expect(result.saved.maxPrice).toBeUndefined();
  });

  it("uses the model's text when no real message is known", async () => {
    const { deps: d } = deps(50);
    const result = await updateSearch(d, "chat-a", {
      text: "homes in Irvine under $2M",
      attempt: 1,
      cities: [irvine],
      maxPrice: { value: 2_000_000, evidence: "under $2M" },
    });
    expect(result.outcome).toBe("ok");
  });
});

describe("showListings", () => {
  it("shows the requested page of the saved search", async () => {
    const { deps: d, queries } = deps(7);
    await updateSearch(d, "chat-a", { text: "homes in Irvine", attempt: 1, cities: [irvine] });
    const page = await showListings(d, "chat-a", 2);
    expect(page.total).toBe(7);
    expect(page.text.startsWith("Showing 6–7 of 7")).toBe(true);
    expect(queries.at(-1)?.params).toContain("Irvine");
  });

  it("showListings past the last page says there are no more", async () => {
    const { deps: d } = deps(7);
    await updateSearch(d, "chat-a", { text: "homes in Irvine", attempt: 1, cities: [irvine] });
    const page = await showListings(d, "chat-a", 3);
    expect(page.text).toContain("No more results");
    expect(page.text).not.toContain("Showing");
  });

  it("showListings with no saved search asks what to look for", async () => {
    const { deps: d } = deps(7);
    const page = await showListings(d, "chat-new", 1);
    expect(page.total).toBe(0);
    expect(page.text).toMatch(/what you're looking for/);
  });
});

describe("showSoldComps", () => {
  it("showSoldComps uses the saved search", async () => {
    const { deps: d, queries } = deps(723);
    await updateSearch(d, "chat-a", { text: "homes in Irvine", attempt: 1, cities: [irvine] });
    const comps = await showSoldComps(d, "chat-a");
    expect(queries.at(-1)?.sql).toContain("FROM california_sold");
    expect(queries.at(-1)?.params).toContain("Irvine");
    expect(comps.summary?.count).toBe(1);
    expect(comps.text).toContain("Recently sold");
  });

  it("asks what to look for when there is no search", async () => {
    const { deps: d } = deps(0);
    const comps = await showSoldComps(d, "chat-new");
    expect(comps.summary).toBeNull();
    expect(comps.text).toMatch(/what you're looking for/);
  });
});
