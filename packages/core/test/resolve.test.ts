import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { ExtractionSchema, resolveExtraction, type Extraction } from "../src/index.ts";
import { fixtureVocab } from "./fixtures/vocab.ts";

const handbook: Extraction = {
  text: "Show me 3-bedroom condos in Irvine under $1.5M with a pool.",
  attempt: 1,
  cities: [{ value: "Irvine", evidence: "Irvine" }],
  minBeds: { value: 3, evidence: "3-bedroom" },
  types: [{ value: "Condominium", evidence: "condos" }],
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
      { ...handbook, text: "3br condo in irivine", cities: [{ value: "irivine", evidence: "irivine" }], maxPrice: undefined, minBeds: { value: 3, evidence: "3br" }, types: [{ value: "Condominium", evidence: "condo" }], pool: undefined },
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

describe("resolveExtraction review fixes", () => {
  const base = { attempt: 1 as const };

  it("rejects a city whose quote names a different city", () => {
    const result = resolveExtraction({ ...base, text: "condo in Tustin", cities: [{ value: "Irvine", evidence: "Tustin" }] }, fixtureVocab);
    expect(result.outcome).toBe("needs_retry");
    expect(result.issues).toEqual([expect.objectContaining({ field: "cities", kind: "evidence_mismatch" })]);
    expect(result.filters.cities).toBeUndefined();
  });

  it("rejects pool required when the quote says no pool", () => {
    const result = resolveExtraction(
      { ...base, text: "house in Orange with no pool", pool: { value: true, priority: "must", evidence: "no pool" } },
      fixtureVocab,
    );
    expect(result.issues).toEqual([expect.objectContaining({ field: "pool", kind: "evidence_mismatch" })]);
  });

  it("flags a monthly price as a rental, whatever the amount", () => {
    const result = resolveExtraction(
      { ...base, text: "place in Irvine for $12,000/month", cities: [{ value: "Irvine", evidence: "Irvine" }], maxPrice: { value: 12_000, evidence: "$12,000/month" } },
      fixtureVocab,
    );
    expect(result.outcome).toBe("ambiguous");
    expect(result.issues.map((issue) => issue.kind)).toEqual(["rental"]);
    expect(result.filters.maxPrice).toBeUndefined();
  });

  it("flags rental wording even without a price", () => {
    const result = resolveExtraction({ ...base, text: "condo to rent in Irvine", cities: [{ value: "Irvine", evidence: "Irvine" }] }, fixtureVocab);
    expect(result.outcome).toBe("ambiguous");
    expect(result.issues.map((issue) => issue.kind)).toEqual(["rental"]);
  });

  it("does not treat a monthly HOA fee as a rental", () => {
    const result = resolveExtraction(
      { ...base, text: "condo in Irvine, HOA under $500/month", cities: [{ value: "Irvine", evidence: "Irvine" }], maxHoa: { value: 500, evidence: "HOA under $500/month" } },
      fixtureVocab,
    );
    expect(result.outcome).toBe("ok");
    expect(result.filters.maxHoa).toBe(500);
  });

  it("rejects a generic word in place of a dataset type", () => {
    // The format contract has the model leave types out for "homes"; the schema
    // rejects anything that is not one of the dataset's type names.
    expect(Value.Check(ExtractionSchema, { text: "homes in Irvine", attempt: 1, types: [{ value: "homes", evidence: "homes" }] })).toBe(false);
  });

  it("keeps each dataset type once when several words map to it", () => {
    const result = resolveExtraction(
      { ...base, text: "family home or house in Irvine", types: [{ value: "SingleFamilyResidence", evidence: "family home" }, { value: "SingleFamilyResidence", evidence: "house" }] },
      fixtureVocab,
    );
    expect(result.filters.types).toEqual(["SingleFamilyResidence"]);
  });

  it("tells the model to quote the whole price phrase when a quote is partial", () => {
    const result = resolveExtraction(
      { ...base, text: "condo in Irvine for 1 to 2 million", minPrice: { value: 1_000_000, evidence: "1 to" }, maxPrice: { value: 2_000_000, evidence: "2 million" } },
      fixtureVocab,
    );
    expect(result.outcome).toBe("needs_retry");
    expect(result.issues[0].message).toMatch(/quote the whole price phrase/i);
  });

  it("takes a dataset type name chosen by the model", () => {
    const result = resolveExtraction(
      { ...base, text: "condo in Irvine", cities: [{ value: "Irvine", evidence: "Irvine" }], types: [{ value: "Condominium", evidence: "condo" }] },
      fixtureVocab,
    );
    expect(result.outcome).toBe("ok");
    expect(result.filters.types).toEqual(["Condominium"]);
  });

  it("matches a capitalized city typed with a typo", () => {
    const result = resolveExtraction({ ...base, text: "condo in irivine", cities: [{ value: "Irivine", evidence: "irivine" }] }, fixtureVocab);
    expect(result.outcome).toBe("needs_confirmation");
    expect(result.filters.cities?.[0].values).toEqual(["Irvine"]);
  });

  it("reads a studio as zero bedrooms", () => {
    const result = resolveExtraction({ ...base, text: "studio in Irvine", cities: [{ value: "Irvine", evidence: "Irvine" }], minBeds: { value: 0, evidence: "studio" } }, fixtureVocab);
    expect(result.outcome).toBe("ok");
    expect(result.filters.minBeds).toBe(0);
  });
});

