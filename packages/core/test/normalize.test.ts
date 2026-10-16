import { describe, expect, it } from "vitest";
import { normalizeText, parseAmount, parseCount } from "../src/index.ts";

describe("normalizeText", () => {
  it.each([
    ["  Newport   BCH. ", "newport beach"],
    ["St. Helena", "saint helena"],
    ["Mt Shasta", "mount shasta"],
    ["O'Neals", "o'neals"],
    ["“Irvine”", "irvine"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeText(input)).toBe(expected);
  });

  it("normalizeText handles emoji and accents", () => {
    expect(normalizeText("🏠 in Cañon City")).toBe("in cañon city");
  });
});

describe("parseAmount", () => {
  it.each([
    ["$1.5M", 1_500_000],
    ["1.5 mil", 1_500_000],
    ["1.5 million", 1_500_000],
    ["under 1.5m", 1_500_000],
    ["800k", 800_000],
    ["$800K", 800_000],
    ["$1,200,000", 1_200_000],
    ["$500/month", 500],
  ])("reads %j as %d", (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it("returns null when there is no number", () => {
    expect(parseAmount("three bedrooms")).toBeNull();
  });
});

describe("parseCount", () => {
  it.each([
    ["3br", 3],
    ["3 bed", 3],
    ["three bedrooms", 3],
    ["2.5 baths", 2.5],
  ])("reads %j as %d", (input, expected) => {
    expect(parseCount(input)).toBe(expected);
  });

  it("returns null for vague quantities", () => {
    expect(parseCount("a few")).toBeNull();
  });
});
