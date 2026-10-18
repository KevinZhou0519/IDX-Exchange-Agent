import { describe, expect, it } from "vitest";
import { checkEvidence, checkPlausible } from "../src/index.ts";

describe("checkEvidence", () => {
  const text = "3br condo under $1.5M";

  it("accepts a quote that is in the message and supports the value", () => {
    expect(checkEvidence(text, "under $1.5M", 1_500_000, "amount")).toBe("ok");
  });

  it("catches a value the quote does not support", () => {
    expect(checkEvidence(text, "under $1.5M", 150_000, "amount")).toBe("value_mismatch");
  });

  it("catches a quote that is not in the message", () => {
    expect(checkEvidence(text, "under $2M", 2_000_000, "amount")).toBe("not_in_message");
  });

  it("evidence tolerates spacing, case and curly quotes", () => {
    expect(checkEvidence("Find a home in “Newport   Beach”", "newport beach")).toBe("ok");
  });
});

describe("checkPlausible", () => {
  it.each([
    ["price", 5_000, false],
    ["price", 1_500_000, true],
    ["baths", 2.5, true],
    ["baths", 2.3, false],
    ["beds", 30, false],
  ] as const)("%s %d → %s", (field, value, expected) => {
    expect(checkPlausible(field, value)).toBe(expected);
  });
});

describe("checkEvidence supports the value", () => {
  it("rejects evidence that is empty after cleanup", () => {
    expect(checkEvidence("🏠 condo in Irvine", "🏠")).toBe("not_in_message");
    expect(checkEvidence("condo in Irvine", " ")).toBe("not_in_message");
  });

  it("matches whole words, not fragments", () => {
    expect(checkEvidence("Irvine condo", "vine")).toBe("not_in_message");
  });

  it("requires a city or type value to appear in its quote", () => {
    expect(checkEvidence("condo in Tustin", "Tustin", "Irvine", "word")).toBe("value_mismatch");
    expect(checkEvidence("condo in irivine", "in irivine", "irivine", "word")).toBe("ok");
    expect(checkEvidence("house in 29 palms", "29 palms", "29 palms", "word")).toBe("ok");
  });

  it("accepts any amount in a range or worded quote", () => {
    expect(checkEvidence("1 to 2 million in Irvine", "1 to 2 million", 1_000_000, "amount")).toBe("ok");
    expect(checkEvidence("1 to 2 million in Irvine", "1 to 2 million", 2_000_000, "amount")).toBe("ok");
    expect(checkEvidence("homes under a million", "under a million", 1_000_000, "amount")).toBe("ok");
    expect(checkEvidence("homes under a million", "under a million", 100_000, "amount")).toBe("value_mismatch");
  });

  it("checks negation for yes/no features", () => {
    expect(checkEvidence("condo with no pool", "no pool", true, "feature")).toBe("value_mismatch");
    expect(checkEvidence("condo with no pool", "no pool", false, "feature")).toBe("ok");
    expect(checkEvidence("condo with a pool", "with a pool", true, "feature")).toBe("ok");
    expect(checkEvidence("condo without a view", "without a view", true, "feature")).toBe("value_mismatch");
  });
});
