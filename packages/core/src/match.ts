// Matches a user's word to real dataset values: exact name, alias table, then
// typo tolerance. Ties are reported, never guessed.
import { CITY_ALIASES, TYPE_SYNONYMS } from "./aliases.ts";
import { normalizeText } from "./normalize.ts";
import type { Vocabulary } from "./vocab.ts";

export type Candidate = { value: string; activeListings: number };

export type MatchResult =
  | { kind: "exact" | "alias" | "fuzzy"; values: string[]; activeListings: number }
  | { kind: "ambiguous"; candidates: Candidate[] }
  | { kind: "none"; candidates: Candidate[] };

const SUGGESTION_COUNT = 3;

/** Edit distance where insert, delete, substitute and swapping two neighbors each cost 1. */
export function damerauLevenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const d: number[][] = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[rows - 1][cols - 1];
}

function maxTypoDistance(normalizedInput: string): number {
  if (normalizedInput.length <= 4) return 0;
  if (normalizedInput.length <= 8) return 1;
  return 2;
}

function byListingsDesc(a: Candidate, b: Candidate): number {
  return b.activeListings - a.activeListings;
}

function matchAgainst(
  input: string,
  entries: Candidate[],
  aliases: Record<string, string[]>,
): MatchResult {
  const key = normalizeText(input);
  const listings = new Map(entries.map((entry) => [entry.value, entry.activeListings]));
  const byKey = new Map(entries.map((entry) => [normalizeText(entry.value), entry]));
  const aliasTable = new Map(
    Object.entries(aliases).map(([alias, values]) => [normalizeText(alias), values]),
  );

  const exact = byKey.get(key);
  const aliasValues = (aliasTable.get(key) ?? []).filter((value) => listings.has(value));
  // An alias wins only when it adds something the exact hit lacks (e.g. both
  // spellings of one city); otherwise the match is reported as exact.
  const aliasAddsValues =
    aliasValues.length > 0 && !(exact && aliasValues.length === 1 && aliasValues[0] === exact.value);
  if (aliasAddsValues) {
    const total = aliasValues.reduce((sum, value) => sum + (listings.get(value) ?? 0), 0);
    return { kind: "alias", values: aliasValues, activeListings: total };
  }
  if (exact) {
    return { kind: "exact", values: [exact.value], activeListings: exact.activeListings };
  }

  const scored = [...byKey]
    .map(([name, entry]) => ({ entry, distance: damerauLevenshtein(key, name) }))
    .sort((a, b) => a.distance - b.distance || byListingsDesc(a.entry, b.entry));
  const best = scored[0]?.distance;
  if (best !== undefined && best <= maxTypoDistance(key)) {
    const closest = scored.filter((item) => item.distance === best).map((item) => item.entry);
    if (closest.length === 1) {
      return { kind: "fuzzy", values: [closest[0].value], activeListings: closest[0].activeListings };
    }
    return { kind: "ambiguous", candidates: closest.sort(byListingsDesc) };
  }
  return { kind: "none", candidates: scored.slice(0, SUGGESTION_COUNT).map((item) => item.entry) };
}

export function matchCity(input: string, vocab: Vocabulary): MatchResult {
  const entries = vocab.cities.map((city) => ({ value: city.name, activeListings: city.activeListings }));
  return matchAgainst(input, entries, CITY_ALIASES);
}

export function matchType(input: string, vocab: Vocabulary): MatchResult {
  const entries = vocab.types.map((type) => ({ value: type.name, activeListings: type.activeListings }));
  const synonyms = Object.fromEntries(
    Object.entries(TYPE_SYNONYMS).map(([word, type]) => [word, [type]]),
  );
  return matchAgainst(input, entries, synonyms);
}
