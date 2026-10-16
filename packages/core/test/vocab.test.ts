import { describe, expect, it } from "vitest";
import { loadVocabulary } from "../src/index.ts";

describe("loadVocabulary", () => {
  it("loadVocabulary explains how to build a missing file", () => {
    expect(() => loadVocabulary("/nonexistent.json")).toThrow(/corepack pnpm vocab/);
  });
});
