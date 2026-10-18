// Checks the model's extraction against the user's words and the dataset, and
// decides what the agent does next: proceed, confirm, retry once, or ask.
import type {
  Extraction,
  Feature,
  FilterField,
  Issue,
  Outcome,
  ResolvedFilters,
  ResolveResult,
} from "./filters.ts";
import { GENERIC_TYPE_WORDS } from "./aliases.ts";
import { matchCity, matchType, type MatchResult } from "./match.ts";
import { normalizeText } from "./normalize.ts";
import { checkEvidence, checkPlausible, type PLAUSIBLE } from "./validate.ts";
import type { Vocabulary } from "./vocab.ts";

/** Below this many active listings a matched city is worth confirming. */
export const LOW_LISTINGS_THRESHOLD = 10;

type NumericField = "minPrice" | "maxPrice" | "minBeds" | "minBaths" | "minSqft" | "maxHoa";

const NUMERIC_FIELDS: Record<NumericField, { kind: "amount" | "count"; range: keyof typeof PLAUSIBLE }> = {
  minPrice: { kind: "amount", range: "price" },
  maxPrice: { kind: "amount", range: "price" },
  minBeds: { kind: "count", range: "beds" },
  minBaths: { kind: "count", range: "baths" },
  minSqft: { kind: "amount", range: "sqft" },
  maxHoa: { kind: "amount", range: "hoa" },
};

const RETRYABLE = new Set(["not_found", "evidence_mismatch", "implausible"]);

/** A monthly amount ("$3,000/month", "per month") is rent, not a sale price. */
const MONTHLY = /(\/\s*mo(nth)?\b|\bper\s+mo(nth)?\b|\ba\s+month\b|\bmonthly\b)/i;
const RENTAL_WORDS = /\b(rent|rents|rental|rentals|renting|lease|leasing)\b/i;
const PRICE_FIELDS = ["minPrice", "maxPrice"] as const;
const CONFIRMABLE = new Set(["auto_corrected", "low_listings"]);

function describeCandidates(candidates: { value: string; activeListings: number }[]): string {
  return candidates.map((c) => `${c.value} (${c.activeListings} listings)`).join(", ");
}

/** Turns a match into an issue when it needs attention; returns null when it is clean. */
function matchIssue(field: string, input: string, match: MatchResult, label: string): Issue | null {
  if (match.kind === "ambiguous") {
    return {
      field,
      kind: "ambiguous",
      input,
      candidates: match.candidates,
      message: `"${input}" could be more than one ${label}: ${describeCandidates(match.candidates)}.`,
    };
  }
  if (match.kind === "none") {
    return {
      field,
      kind: "not_found",
      input,
      candidates: match.candidates,
      message: `No ${label} called "${input}" in the data. Closest: ${describeCandidates(match.candidates)}.`,
    };
  }
  if (match.kind === "fuzzy") {
    return {
      field,
      kind: "auto_corrected",
      input,
      message: `Read "${input}" as ${match.values.join(" / ")}.`,
    };
  }
  return null;
}

function evidenceReason(check: "not_in_message" | "value_mismatch", value: unknown): string {
  return check === "not_in_message" ? "quote is not in the message" : `quote does not support ${JSON.stringify(value)}`;
}

function evidenceIssue(field: string, input: string, evidence: string, reason: string): Issue {
  return {
    field,
    kind: "evidence_mismatch",
    input,
    message: `${field}: ${reason} (quoted "${evidence}").`,
  };
}

function decideOutcome(issues: Issue[], attempt: number): Outcome {
  // Rentals and ties need the user, not another extraction.
  if (issues.some((issue) => issue.kind === "ambiguous" || issue.kind === "rental")) return "ambiguous";
  if (issues.some((issue) => RETRYABLE.has(issue.kind))) return attempt === 1 ? "needs_retry" : "ambiguous";
  if (issues.some((issue) => CONFIRMABLE.has(issue.kind))) return "needs_confirmation";
  return "ok";
}

const dollars = (n: number) => `$${n.toLocaleString("en-US")}`;

function describeFeature(name: string, feature: Feature): string {
  if (!feature.value) return `no ${name}`;
  return `${name} ${feature.priority === "must" ? "required" : "preferred"}`;
}

/** One plain sentence describing what will be searched. */
export function summarize(filters: ResolvedFilters): string {
  const head = [
    filters.minBeds !== undefined ? `${filters.minBeds}+ bed` : "",
    filters.minBaths !== undefined ? `${filters.minBaths}+ bath` : "",
    filters.types?.length ? filters.types.join(" or ") : "home",
  ]
    .filter(Boolean)
    .join(" ");
  const parts = [head];
  if (filters.cities?.length) parts[0] += ` in ${filters.cities.flatMap((c) => c.values).join(" or ")}`;
  if (filters.minPrice !== undefined && filters.maxPrice !== undefined) {
    parts.push(`${dollars(filters.minPrice)} to ${dollars(filters.maxPrice)}`);
  } else if (filters.maxPrice !== undefined) {
    parts.push(`up to ${dollars(filters.maxPrice)}`);
  } else if (filters.minPrice !== undefined) {
    parts.push(`from ${dollars(filters.minPrice)}`);
  }
  if (filters.minSqft !== undefined) parts.push(`${filters.minSqft.toLocaleString("en-US")}+ sq ft`);
  if (filters.maxHoa !== undefined) parts.push(`HOA up to ${dollars(filters.maxHoa)}`);
  if (filters.pool) parts.push(describeFeature("pool", filters.pool));
  if (filters.view) parts.push(describeFeature("view", filters.view));
  if (filters.excludeTypes?.length) parts.push(`excluding ${filters.excludeTypes.join(", ")}`);
  if (filters.wishes) parts.push(`wishes: "${filters.wishes}"`);
  return parts.join(", ");
}

export function resolveExtraction(input: Extraction, vocab: Vocabulary): ResolveResult {
  const { text, attempt } = input;
  const issues: Issue[] = [];
  const filters: ResolvedFilters = { sources: {} };
  const markSource = (field: FilterField) => {
    filters.sources[field] = "llm";
  };

  if (input.cities?.length) {
    markSource("cities");
    for (const city of input.cities) {
      const evidence = checkEvidence(text, city.evidence, city.value, "word");
      if (evidence !== "ok") {
        issues.push(evidenceIssue("cities", city.value, city.evidence, evidenceReason(evidence, city.value)));
        continue;
      }
      const match = matchCity(city.value, vocab);
      const issue = matchIssue("cities", city.value, match, "city");
      if (issue) issues.push(issue);
      if (match.kind === "exact" || match.kind === "alias" || match.kind === "fuzzy") {
        (filters.cities ??= []).push({
          values: match.values,
          input: city.value,
          match: match.kind,
          activeListings: match.activeListings,
        });
        if (match.activeListings < LOW_LISTINGS_THRESHOLD) {
          issues.push({
            field: "cities",
            kind: "low_listings",
            input: city.value,
            message: `Only ${match.activeListings} active listings are filed under ${match.values.join(" / ")}.`,
          });
        }
      }
    }
  }

  for (const field of ["types", "excludeTypes"] as const) {
    const items = input[field];
    if (!items?.length) continue;
    markSource(field);
    for (const item of items) {
      if (GENERIC_TYPE_WORDS.has(normalizeText(item.value))) continue;
      const evidence = checkEvidence(text, item.evidence, item.value, "word");
      if (evidence !== "ok") {
        issues.push(evidenceIssue(field, item.value, item.evidence, evidenceReason(evidence, item.value)));
        continue;
      }
      const match = matchType(item.value, vocab);
      const issue = matchIssue(field, item.value, match, "property type");
      if (issue) issues.push(issue);
      if (match.kind === "exact" || match.kind === "alias" || match.kind === "fuzzy") {
        (filters[field] ??= []).push(...match.values);
      }
    }
  }

  const monthlyPrice = PRICE_FIELDS.map((field) => input[field]).find((item) => item && MONTHLY.test(item.evidence));
  const rental = monthlyPrice !== undefined || RENTAL_WORDS.test(text);
  if (rental) {
    issues.push({
      field: monthlyPrice ? "maxPrice" : "text",
      kind: "rental",
      input: monthlyPrice?.evidence ?? text,
      message: "This looks like a rental search; the listings are homes for sale.",
    });
  }

  for (const [field, rule] of Object.entries(NUMERIC_FIELDS) as [NumericField, (typeof NUMERIC_FIELDS)[NumericField]][]) {
    const item = input[field];
    if (!item) continue;
    markSource(field);
    // A rental budget is not a sale price; the rental issue already covers it.
    if (rental && (field === "minPrice" || field === "maxPrice")) continue;
    const evidence = checkEvidence(text, item.evidence, item.value, rule.kind);
    if (evidence !== "ok") {
      const hint =
        rule.kind === "amount" && evidence === "value_mismatch"
          ? "; quote the whole price phrase (for a range, the whole range for both min and max)"
          : "";
      issues.push(evidenceIssue(field, String(item.value), item.evidence, evidenceReason(evidence, item.value) + hint));
      continue;
    }
    if (!checkPlausible(rule.range, item.value)) {
      issues.push({
        field,
        kind: "implausible",
        input: String(item.value),
        message: `${field} ${item.value} is outside the believable range for a home sale.`,
      });
      continue;
    }
    filters[field] = item.value;
  }

  if (filters.minPrice !== undefined && filters.maxPrice !== undefined && filters.minPrice > filters.maxPrice) {
    issues.push({
      field: "maxPrice",
      kind: "implausible",
      input: String(filters.maxPrice),
      message: `Maximum price ${dollars(filters.maxPrice)} is below the minimum ${dollars(filters.minPrice)}.`,
    });
    delete filters.maxPrice;
  }

  for (const field of ["pool", "view"] as const) {
    const item = input[field];
    if (!item) continue;
    markSource(field);
    const evidence = checkEvidence(text, item.evidence, item.value, "feature");
    if (evidence !== "ok") {
      issues.push(evidenceIssue(field, String(item.value), item.evidence, evidenceReason(evidence, item.value)));
      continue;
    }
    filters[field] = { value: item.value, priority: item.priority };
  }

  if (input.wishes?.trim()) {
    markSource("wishes");
    filters.wishes = input.wishes.trim();
  }

  return { outcome: decideOutcome(issues, attempt), attempt, filters, issues, summary: summarize(filters) };
}
