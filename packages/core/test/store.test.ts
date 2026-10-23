import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SEARCH_EXPIRY_MS,
  createMemoryStore,
  createSqliteStore,
  type ResolvedFilters,
  type SearchStore,
} from "../src/index.ts";

const search: ResolvedFilters = { minBeds: 3, maxPrice: 1_000_000, sources: { minBeds: "llm", maxPrice: "user" } };
const tempFile = () => join(mkdtempSync(join(tmpdir(), "idx-store-")), "nested", "searches.sqlite");

const stores: [string, (now: () => number) => SearchStore][] = [
  ["memory", (now) => createMemoryStore(now)],
  ["sqlite", (now) => createSqliteStore(tempFile(), now)],
];

describe.each(stores)("%s store", (_name, make) => {
  it("round-trips a search", () => {
    const store = make(() => 1_000);
    store.save("chat-a", search);
    expect(store.get("chat-a")).toEqual({ filters: search, updatedAt: 1_000 });
  });

  it("keeps searches separate per session", () => {
    const store = make(() => 1_000);
    store.save("chat-a", search);
    store.save("chat-b", { minBeds: 1, sources: {} });
    expect(store.get("chat-a")?.filters).toEqual(search);
    expect(store.get("chat-b")?.filters).toEqual({ minBeds: 1, sources: {} });
    expect(store.get("chat-c")).toBeUndefined();
  });

  it("forgets a search after 24 hours", () => {
    let now = 1_000;
    const store = make(() => now);
    store.save("chat-a", search);
    now += SEARCH_EXPIRY_MS;
    expect(store.get("chat-a")).toBeDefined();
    now += 1;
    expect(store.get("chat-a")).toBeUndefined();
  });

  it("clear removes it", () => {
    const store = make(() => 1_000);
    store.save("chat-a", search);
    store.clear("chat-a");
    expect(store.get("chat-a")).toBeUndefined();
  });
});

describe("sqlite store", () => {
  it("survives reopening the file", () => {
    const path = tempFile();
    createSqliteStore(path, () => 5_000).save("chat-a", search);
    expect(createSqliteStore(path, () => 6_000).get("chat-a")).toEqual({ filters: search, updatedAt: 5_000 });
  });
});
