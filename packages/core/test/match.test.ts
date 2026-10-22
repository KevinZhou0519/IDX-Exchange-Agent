import { describe, expect, it } from "vitest";
import { damerauLevenshtein, matchCity } from "../src/index.ts";
import { fixtureVocab } from "./fixtures/vocab.ts";

describe("damerauLevenshtein", () => {
  it("counts a deleted letter and a swapped pair as one edit", () => {
    expect(damerauLevenshtein("irivine", "irvine")).toBe(1);
    expect(damerauLevenshtein("san deigo", "san diego")).toBe(1);
  });
});

describe("matchCity", () => {
  it("matches an exact name", () => {
    expect(matchCity("Irvine", fixtureVocab)).toMatchObject({ kind: "exact", values: ["Irvine"] });
  });

  it("auto-corrects a single close typo", () => {
    expect(matchCity("irivine", fixtureVocab)).toMatchObject({ kind: "fuzzy", values: ["Irvine"] });
  });

  it("reports a tie as ambiguous, most listings first", () => {
    expect(matchCity("irvin", fixtureVocab)).toEqual({
      kind: "ambiguous",
      candidates: [
        { value: "Irvine", activeListings: 723 },
        { value: "Arvin", activeListings: 3 },
      ],
    });
  });

  it("resolves nicknames through the alias table", () => {
    expect(matchCity("LA", fixtureVocab)).toMatchObject({ kind: "alias", values: ["Los Angeles"] });
  });

  it("maps both spellings of one place and sums their listings", () => {
    expect(matchCity("twentynine palms", fixtureVocab)).toEqual({
      kind: "alias",
      values: ["29 Palms", "Twentynine Palms"],
      activeListings: 220,
    });
  });

  it("expands abbreviations before matching", () => {
    expect(matchCity("newport bch", fixtureVocab)).toMatchObject({ kind: "exact", values: ["Newport Beach"] });
  });

  it("returns none with suggestions for an unknown city", () => {
    const result = matchCity("Gotham", fixtureVocab);
    expect(result.kind).toBe("none");
    expect(result.kind === "none" && result.candidates.length).toBe(3);
  });

  it("never fuzzy-matches names of four characters or fewer", () => {
    expect(matchCity("irv", fixtureVocab).kind).toBe("none");
  });
});
