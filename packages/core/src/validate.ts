// Guards against the model misreading or inventing values: every value must be
// backed by the user's own words and fall in a believable range.
import { normalizeText, parseAmount, parseCount } from "./normalize.ts";

export type EvidenceCheck = "ok" | "not_in_message" | "value_mismatch";

export function checkEvidence(
  text: string,
  evidence: string,
  value?: number,
  kind?: "amount" | "count",
): EvidenceCheck {
  if (!normalizeText(text).includes(normalizeText(evidence))) return "not_in_message";
  if (value === undefined || kind === undefined) return "ok";
  const parsed = kind === "amount" ? parseAmount(evidence) : parseCount(evidence);
  return parsed === value ? "ok" : "value_mismatch";
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
