import { describe, expect, it } from "vitest";
import { applyUpdate, type ResolvedFilters } from "../src/index.ts";

const irvine = { values: ["Irvine"], input: "Irvine", match: "exact" as const, activeListings: 723 };
const saved: ResolvedFilters = {
  cities: [irvine],
  maxPrice: 1_200_000,
  types: ["Condominium"],
  pool: { value: true, priority: "must" },
  sources: { cities: "llm", maxPrice: "llm", types: "llm", pool: "llm" },
};

describe("applyUpdate", () => {
  it("changes only the fields in the update", () => {
    const next = applyUpdate(saved, { maxPrice: 1_000_000, sources: { maxPrice: "user" } }, [], false);
    expect(next).toEqual({ ...saved, maxPrice: 1_000_000, sources: { ...saved.sources, maxPrice: "user" } });
  });

  it("replaces lists as a whole", () => {
    const next = applyUpdate(saved, { types: ["SingleFamilyResidence"], sources: { types: "llm" } }, [], false);
    expect(next.types).toEqual(["SingleFamilyResidence"]);
  });

  it("removes fields", () => {
    const next = applyUpdate(saved, { sources: {} }, ["pool"], false);
    expect(next.pool).toBeUndefined();
    expect(next.sources.pool).toBeUndefined();
    expect(next.cities).toEqual([irvine]);
  });

  it("removes before applying, so one message can drop and set", () => {
    const next = applyUpdate(saved, { maxPrice: 900_000, sources: { maxPrice: "llm" } }, ["maxPrice", "pool"], false);
    expect(next.maxPrice).toBe(900_000);
    expect(next.pool).toBeUndefined();
  });

  it("reset starts empty", () => {
    const next = applyUpdate(saved, { minBeds: 2, sources: { minBeds: "llm" } }, [], true);
    expect(next).toEqual({ minBeds: 2, sources: { minBeds: "llm" } });
  });

  it("starts from nothing when there is no saved search", () => {
    expect(applyUpdate(undefined, { minBeds: 2, sources: { minBeds: "llm" } }, [], false)).toEqual({
      minBeds: 2,
      sources: { minBeds: "llm" },
    });
  });

  it("does not change the saved object", () => {
    const copy = structuredClone(saved);
    applyUpdate(saved, { maxPrice: 1, sources: {} }, ["pool"], false);
    expect(saved).toEqual(copy);
  });
});
