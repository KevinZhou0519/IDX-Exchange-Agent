// Guards against the model misreading or inventing values: every value must be
// backed by the user's own words and fall in a believable range.
import { normalizeText, parseAmounts, parseCount } from "./normalize.ts";

export type EvidenceCheck = "ok" | "not_in_message" | "value_mismatch";

/** How a value relates to its quote: a number in it, a word in it, or a yes/no feature. */
export type EvidenceKind = "amount" | "count" | "word" | "feature";

const NEGATION = /\b(no|not|without|non)\b/;
const UNVERIFIABLE_COUNT = /half|½|¼|¾|\/|studio/i;

/** Whole-word containment of normalized text: "vine" is not in "irvine condo". */
function containsWords(haystack: string, needle: string): boolean {
  return ` ${haystack} `.includes(` ${needle} `);
}

export function checkEvidence(
  text: string,
  evidence: string,
  value?: number | string | boolean,
  kind?: EvidenceKind,
): EvidenceCheck {
  const quote = normalizeText(evidence);
  if (quote === "" || !containsWords(normalizeText(text), quote)) return "not_in_message";
  if (value === undefined || kind === undefined) return "ok";
  switch (kind) {
    case "amount":
      return parseAmounts(evidence).includes(value as number) ? "ok" : "value_mismatch";
    case "count":
      // Phrasings the reader cannot verify ("2 and a half", "2½", "3/2",
      // "studio") are trusted to the model; the value's format and range
      // are still checked. Plain counts it can read must agree.
      if (UNVERIFIABLE_COUNT.test(evidence)) return "ok";
      return parseCount(evidence) === value ? "ok" : "value_mismatch";
    case "word":
      return containsWords(quote, normalizeText(String(value))) ? "ok" : "value_mismatch";
    case "feature":
      return NEGATION.test(quote) === !value ? "ok" : "value_mismatch";
  }
}

export const PLAUSIBLE = {
  price: { min: 10_000, max: 500_000_000 },
  beds: { min: 0, max: 20 },
  baths: { min: 0, max: 20, step: 0.5 },
  sqft: { min: 100, max: 50_000 },
  hoa: { min: 0, max: 10_000 },
} satisfies Record<string, { min: number; max: number; step?: number }>;

export function checkPlausible(field: keyof typeof PLAUSIBLE, value: number): boolean {
  const range: { min: number; max: number; step?: number } = PLAUSIBLE[field];
  if (!Number.isFinite(value) || value < range.min || value > range.max) return false;
  return range.step === undefined || Number.isInteger(value / range.step);
}
