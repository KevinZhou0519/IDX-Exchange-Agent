import { describe, expect, it } from "vitest";
import { planNext, type Counter, type ResolvedFilters } from "../src/index.ts";

const irvine = { values: ["Irvine"], input: "Irvine", match: "exact" as const, activeListings: 723 };

/** A pretend database: counts come from a function of the filters. */
function fakeCounter(count: (f: ResolvedFilters) => number, overrides: Partial<Counter> = {}): Counter {
  return {
    count: async (f) => count(f),
    facet: async (_f, facet) =>
      ({
        city: [
          { value: "Los Angeles", total: 4015 },
          { value: "San Diego", total: 2198 },
          { value: "San Jose", total: 1047 },
          { value: "Irvine", total: 723 },
          { value: "Palm Desert", total: 598 },
        ],
        type: [
          { value: "Condominium", total: 163 },
          { value: "Townhouse", total: 26 },
          { value: "SingleFamilyResidence", total: 12 },
          { value: "ManufacturedOnLand", total: 7 },
        ],
        beds: [
          { value: 1, total: 20 },
          { value: 2, total: 80 },
          { value: 3, total: 70 },
          { value: 4, total: 30 },
          { value: 5, total: 8 },
        ],
      })[facet],
    priceQuartiles: async () => [900_000, 1_250_000, 2_500_000],
    ...overrides,
  };
}

describe("planNext", () => {
  it("shows when 20 or fewer", async () => {
    expect(await planNext({ cities: [irvine], sources: {} }, fakeCounter(() => 18))).toEqual({ action: "show", total: 18 });
  });

  it("asks for the city first", async () => {
    const next = await planNext({ sources: {} }, fakeCounter(() => 55_212));
    expect(next).toMatchObject({ action: "ask", total: 55_212, facet: "city" });
    expect(next.action === "ask" && next.options).toHaveLength(5);
    expect(next.action === "ask" && next.options[0]).toEqual({ label: "Los Angeles (4,015)", total: 4015 });
  });

  it("then the budget, with real price points", async () => {
    const next = await planNext({ cities: [irvine], sources: {} }, fakeCounter(() => 723));
    expect(next).toEqual({
      action: "ask",
      total: 723,
      facet: "price",
      options: [{ label: "$900,000" }, { label: "$1,250,000" }, { label: "$2,500,000" }],
    });
  });

  it("then the type, with counts", async () => {
    const next = await planNext({ cities: [irvine], maxPrice: 1_200_000, sources: {} }, fakeCounter(() => 208));
    expect(next).toMatchObject({ action: "ask", total: 208, facet: "type" });
    expect(next.action === "ask" && next.options.slice(0, 2)).toEqual([
      { label: "Condominium (163)", total: 163 },
      { label: "Townhouse (26)", total: 26 },
    ]);
  });

  it("then bedrooms", async () => {
    const next = await planNext(
      { cities: [irvine], maxPrice: 2_000_000, types: ["Condominium"], sources: {} },
      fakeCounter(() => 208),
    );
    expect(next).toMatchObject({ action: "ask", facet: "beds" });
    expect(next.action === "ask" && next.options.at(-1)).toEqual({ label: "5+ bd (8)", total: 8 });
  });

  it("skips a facet with one option", async () => {
    const next = await planNext(
      { cities: [irvine], maxPrice: 1_200_000, sources: {} },
      fakeCounter(() => 208, { facet: async (_f, facet) => (facet === "type" ? [{ value: "Condominium", total: 208 }] : [{ value: 2, total: 100 }, { value: 3, total: 108 }]) }),
    );
    expect(next).toMatchObject({ action: "ask", facet: "beds" });
  });

  it("shows anyway when every facet is set", async () => {
    const next = await planNext(
      { cities: [irvine], maxPrice: 3_000_000, types: ["Condominium"], minBeds: 2, sources: {} },
      fakeCounter(() => 150),
    );
    expect(next).toEqual({ action: "show", total: 150 });
  });

  it("suggests what to relax", async () => {
    const counts = (f: ResolvedFilters) => {
      if (f.maxPrice === undefined) return 12;
      if (f.types === undefined) return 4;
      return 0;
    };
    const next = await planNext(
      { cities: [irvine], maxPrice: 500_000, types: ["Condominium"], minBeds: 5, sources: {} },
      fakeCounter(counts),
    );
    expect(next).toEqual({
      action: "relax",
      total: 0,
      suggestions: [
        { remove: "maxPrice", total: 12 },
        { remove: "types", total: 4 },
      ],
    });
  });

  it("does not suggest removing the only filter", async () => {
    expect(await planNext({ cities: [irvine], sources: {} }, fakeCounter(() => 0))).toEqual({
      action: "relax",
      total: 0,
      suggestions: [],
    });
  });

  it("never suggests dropping the city", async () => {
    const counts = (f: ResolvedFilters) => (f.cities === undefined ? 500 : 0);
    const next = await planNext({ cities: [irvine], minBeds: 9, sources: {} }, fakeCounter(counts));
    expect(next).toEqual({ action: "relax", total: 0, suggestions: [] });
  });
});
