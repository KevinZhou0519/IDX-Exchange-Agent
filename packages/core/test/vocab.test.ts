import { describe, expect, it } from "vitest";
import { isPlaceholderCity, loadVocabulary } from "../src/index.ts";

describe("loadVocabulary", () => {
  it("loadVocabulary explains how to build a missing file", () => {
    expect(() => loadVocabulary("/nonexistent.json")).toThrow(/corepack pnpm vocab/);
  });
});

describe("isPlaceholderCity", () => {
  it("flags placeholder values that are not real places", () => {
    for (const name of ["Other", "Unknown", "Unincorporated", "  other "]) {
      expect(isPlaceholderCity(name)).toBe(true);
    }
  });

  it("keeps real city names", () => {
    for (const name of ["Irvine", "29 Palms", "Other Town"]) {
      expect(isPlaceholderCity(name)).toBe(false);
    }
  });
});
