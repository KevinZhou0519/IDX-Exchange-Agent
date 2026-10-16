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
