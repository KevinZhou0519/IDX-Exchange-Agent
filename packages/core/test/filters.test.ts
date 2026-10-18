import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { ExtractionSchema } from "../src/index.ts";

const handbookExtraction = {
  text: "3br condo in Irvine under $1.5M",
  attempt: 1,
  cities: [{ value: "Irvine", evidence: "Irvine" }],
  minBeds: { value: 3, evidence: "3br" },
  types: [{ value: "condo", evidence: "condo" }],
  maxPrice: { value: 1500000, evidence: "under $1.5M" },
};

describe("ExtractionSchema", () => {
  it("accepts a full extraction", () => {
    expect(Value.Check(ExtractionSchema, handbookExtraction)).toBe(true);
  });

  it("rejects attempt 3 and empty evidence", () => {
    expect(Value.Check(ExtractionSchema, { ...handbookExtraction, attempt: 3 })).toBe(false);
    expect(
      Value.Check(ExtractionSchema, {
        ...handbookExtraction,
        cities: [{ value: "Irvine", evidence: "" }],
      }),
    ).toBe(false);
  });

  it("rejects unknown field names instead of silently dropping them", () => {
    expect(Value.Check(ExtractionSchema, { ...handbookExtraction, minSquareFeet: { value: 1800, evidence: "1,800 sq ft" } })).toBe(false);
    expect(
      Value.Check(ExtractionSchema, { ...handbookExtraction, minBeds: { value: 3, evidence: "3br", note: "x" } }),
    ).toBe(false);
  });
});
