// Guards against the model misreading or inventing values: every value must be
// backed by the user's own words and fall in a believable range.
import { Value } from "typebox/value";
import { ExtractionSchema, type Issue } from "./filters.ts";
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

const FIELD_NAMES = Object.keys(ExtractionSchema.properties).join(", ");

/**
 * Schema problems in a tool call, one issue per field. OpenClaw does not
 * enforce the schema in Code Mode, so a misnamed field ("propertyTypes")
 * would otherwise be dropped silently.
 */
export function validateExtraction(input: unknown): Issue[] {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return [
      {
        field: "input",
        kind: "invalid_field",
        input: String(input),
        message: `The tool input must be an object with at least "text" and "attempt". Fields: ${FIELD_NAMES}.`,
      },
    ];
  }
  const byField = new Map<string, Issue>();
  for (const error of Value.Errors(ExtractionSchema, input)) {
    if (error.instancePath === "" && error.keyword === "additionalProperties") {
      for (const name of (error.params as { additionalProperties: string[] }).additionalProperties) {
        byField.set(name, {
          field: name,
          kind: "invalid_field",
          input: name,
          message: `Unknown field "${name}". Use only these fields: ${FIELD_NAMES}.`,
        });
      }
      continue;
    }
    if (error.instancePath === "" && error.keyword === "required") {
      for (const name of (error.params as { requiredProperties: string[] }).requiredProperties) {
        byField.set(name, {
          field: name,
          kind: "invalid_field",
          input: name,
          message: `Missing required field "${name}" ("text" is the whole message, "attempt" is 1 or 2).`,
        });
      }
      continue;
    }
    const field = error.instancePath.split("/")[1];
    if (!field || byField.has(field) || error.keyword === "boolean") continue;
    const allowed = (error.params as { allowedValues?: string[] }).allowedValues;
    byField.set(field, {
      field,
      kind: "invalid_field",
      input: error.instancePath,
      message: `${error.instancePath.slice(1)} ${error.message}${allowed ? `: ${allowed.join(", ")}` : ""}.`,
    });
  }
  return [...byField.values()];
}
