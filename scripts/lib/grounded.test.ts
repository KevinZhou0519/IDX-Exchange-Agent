import { describe, expect, it } from "vitest";
import { ungrounded } from "./grounded.ts";

// Made-up report values, not from the dataset.
const report = {
  overall: { sales: 640, medianPrice: 1_234_567, medianPricePerSqft: 612, medianSaleToListPct: 97.46, salesPerMonth: 63.6 },
  change: { price: { from: 820_000, to: 794_000, pct: -3.17 } },
  notes: ["Sales cover March 18, 2026 to September 17, 2026.", "Under about 6 months of supply usually favors sellers."],
};

describe("ungrounded", () => {
  it("accepts numbers copied from the report, with or without commas", () => {
    expect(ungrounded("640 homes sold; the typical home sold for $1,234,567 ($612 per sq ft).", [report])).toEqual([]);
  });

  it("accepts the rounding the skill allows: $1.23M, $820K, one decimal, whole numbers", () => {
    expect(ungrounded("About $1.23M (or $1.2 million); $820K → $794K; 97.5% of asking; down 3.2%; about 64 sales a month.", [report])).toEqual([]);
  });

  it("accepts numbers inside report text and the user's own message", () => {
    expect(ungrounded("From March 18 to September 17, 2026; under about 6 months favors sellers. You asked about 3 cities.", [report, "compare 3 cities"])).toEqual([]);
  });

  it("ignores numbered-list markers", () => {
    expect(ungrounded("1. Prices: $1.23M\n2. Speed", [report])).toEqual([]);
  });

  it("flags numbers no source backs, such as a computed difference or an invented share", () => {
    expect(ungrounded("Prices fell $26,000, and 41% of residents are Hispanic.", [report])).toEqual(["26,000", "41"]);
  });

  it("does not let a rounded reply number pass on a wrong unit", () => {
    expect(ungrounded("$1.23K", [report])).toEqual(["1.23K"]);
  });
});
