import { describe, expect, it } from "vitest";
import { resolveExtraction, type Extraction } from "../src/index.ts";
import { fixtureVocab } from "./fixtures/vocab.ts";

const handbook: Extraction = {
  text: "Show me 3-bedroom condos in Irvine under $1.5M with a pool.",
  attempt: 1,
  cities: [{ value: "Irvine", evidence: "Irvine" }],
  minBeds: { value: 3, evidence: "3-bedroom" },
  types: [{ value: "condos", evidence: "condos" }],
  maxPrice: { value: 1_500_000, evidence: "under $1.5M" },
  pool: { value: true, priority: "must", evidence: "with a pool" },
};

describe("resolveExtraction", () => {
  it("resolves the handbook example cleanly", () => {
    const result = resolveExtraction(handbook, fixtureVocab);
    expect(result.outcome).toBe("ok");
    expect(result.filters.cities?.[0].values).toEqual(["Irvine"]);
    expect(result.filters.types).toEqual(["Condominium"]);
    expect(result.filters.minBeds).toBe(3);
    expect(result.filters.maxPrice).toBe(1_500_000);
    expect(result.filters.pool).toEqual({ value: true, priority: "must" });
    expect(result.filters.sources).toMatchObject({ cities: "llm", maxPrice: "llm", pool: "llm" });
    expect(result.summary).toContain("Irvine");
  });

  it("asks to confirm an auto-corrected city", () => {
    const result = resolveExtraction(
      { ...handbook, text: "3br condo in irivine", cities: [{ value: "irivine", evidence: "irivine" }], maxPrice: undefined, minBeds: { value: 3, evidence: "3br" }, types: [{ value: "condo", evidence: "condo" }], pool: undefined },
      fixtureVocab,
    );
    expect(result.outcome).toBe("needs_confirmation");
    expect(result.issues).toEqual([expect.objectContaining({ kind: "auto_corrected", input: "irivine" })]);
  });

  it("stops retrying after the second attempt", () => {
    const unknown: Extraction = { text: "homes in Gotham", attempt: 1, cities: [{ value: "Gotham", evidence: "Gotham" }] };
    expect(resolveExtraction(unknown, fixtureVocab).outcome).toBe("needs_retry");
    expect(resolveExtraction({ ...unknown, attempt: 2 }, fixtureVocab).outcome).toBe("ambiguous");
  });

  it("flags a minimum price above the maximum", () => {
    const result = resolveExtraction(
      { text: "between $2M and $1M in Irvine", attempt: 1, minPrice: { value: 2_000_000, evidence: "$2M" }, maxPrice: { value: 1_000_000, evidence: "$1M" } },
      fixtureVocab,
    );
    expect(result.issues).toEqual([expect.objectContaining({ field: "maxPrice", kind: "implausible" })]);
  });
});
