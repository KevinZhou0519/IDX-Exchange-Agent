import { describe, expect, it } from "vitest";
import { Value } from "typebox/value";
import { ExtractionSchema, PROPERTY_TYPES } from "../src/index.ts";

const handbookExtraction = {
  text: "3br condo in Irvine under $1.5M",
  attempt: 1,
  cities: [{ value: "Irvine", evidence: "Irvine" }],
  minBeds: { value: 3, evidence: "3br" },
  types: [{ value: "Condominium", evidence: "condo" }],
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

  it("accepts only the dataset's property type names", () => {
    expect(PROPERTY_TYPES).toHaveLength(20);
    expect(Value.Check(ExtractionSchema, { ...handbookExtraction, types: [{ value: "Condominium", evidence: "condo" }] })).toBe(true);
    expect(Value.Check(ExtractionSchema, { ...handbookExtraction, types: [{ value: "condo", evidence: "condo" }] })).toBe(false);
  });

  it("requires whole numbers for beds, prices, sqft and HOA", () => {
    expect(Value.Check(ExtractionSchema, { ...handbookExtraction, minBeds: { value: 2.5, evidence: "3br" } })).toBe(false);
    expect(Value.Check(ExtractionSchema, { ...handbookExtraction, maxPrice: { value: 1_500_000.5, evidence: "under $1.5M" } })).toBe(false);
    expect(Value.Check(ExtractionSchema, { ...handbookExtraction, minBaths: { value: 2.5, evidence: "2.5 baths" } })).toBe(true);
  });

  it("accepts remove and reset", () => {
    expect(Value.Check(ExtractionSchema, { ...handbookExtraction, remove: ["pool", "maxPrice"], reset: true })).toBe(true);
  });

  it("rejects removing an unknown field", () => {
    expect(Value.Check(ExtractionSchema, { ...handbookExtraction, remove: ["swimmingPool"] })).toBe(false);
  });
});

