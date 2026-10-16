// The filter contract shared by every week: the model's raw extraction (tool
// input) and the validated, dataset-matched result the rest of the system uses.
import { Type, type Static } from "typebox";

/** The user's own words that a value was read from. Must appear in the message. */
export const Evidence = Type.String({
  minLength: 1,
  description: "The exact words from the user's message this value came from, copied verbatim",
});

const NumberField = Type.Object({
  value: Type.Number({ description: "Number as a plain value, e.g. 1500000 for $1.5M" }),
  evidence: Evidence,
});
const StringItem = Type.Object({
  value: Type.String({ minLength: 1, description: "The user's word as written (typos included); the tool matches it to the data" }),
  evidence: Evidence,
});
const FeatureField = Type.Object({
  value: Type.Boolean(),
  priority: Type.Union([Type.Literal("must"), Type.Literal("nice")], {
    description: '"must" for a requirement ("with a pool"), "nice" for a preference ("ideally a pool")',
  }),
  evidence: Evidence,
});

export const ExtractionSchema = Type.Object({
  text: Type.String({ minLength: 1, description: "The user's message, verbatim" }),
  attempt: Type.Union([Type.Literal(1), Type.Literal(2)], {
    description: "1 for the first call; 2 only when retrying after outcome needs_retry",
  }),
  cities: Type.Optional(Type.Array(StringItem, { description: "One entry per city or area mentioned" })),
  minPrice: Type.Optional(NumberField),
  maxPrice: Type.Optional(NumberField),
  minBeds: Type.Optional(NumberField),
  minBaths: Type.Optional(NumberField),
  minSqft: Type.Optional(NumberField),
  maxHoa: Type.Optional(NumberField),
  types: Type.Optional(Type.Array(StringItem, { description: "Property types wanted, e.g. condo, townhome, house" })),
  excludeTypes: Type.Optional(
    Type.Array(StringItem, { description: "Property types ruled out, e.g. \"not a condo\"" }),
  ),
  pool: Type.Optional(FeatureField),
  view: Type.Optional(FeatureField),
  wishes: Type.Optional(
    Type.String({ description: "Anything the user wants that the fields above cannot express, e.g. \"near good schools\"" }),
  ),
});

export type Extraction = Static<typeof ExtractionSchema>;

export type FilterField = Exclude<keyof Extraction, "text" | "attempt">;

export type MatchKind = "exact" | "alias" | "fuzzy";

export type Feature = { value: boolean; priority: "must" | "nice" };

export type ResolvedFilters = {
  cities?: { values: string[]; input: string; match: MatchKind; activeListings: number }[];
  minPrice?: number;
  maxPrice?: number;
  minBeds?: number;
  minBaths?: number;
  minSqft?: number;
  maxHoa?: number;
  types?: string[];
  excludeTypes?: string[];
  pool?: Feature;
  view?: Feature;
  wishes?: string;
  /** Where each present field came from; "user" arrives with corrections in Week 4. */
  sources: Partial<Record<FilterField, "llm" | "user">>;
};

export type IssueKind =
  | "not_found"
  | "ambiguous"
  | "evidence_mismatch"
  | "implausible"
  | "low_listings"
  | "auto_corrected";

export type Issue = {
  field: string;
  kind: IssueKind;
  input: string;
  candidates?: { value: string; activeListings: number }[];
  message: string;
};

export type Outcome = "ok" | "needs_confirmation" | "needs_retry" | "ambiguous";

export type ResolveResult = {
  outcome: Outcome;
  attempt: 1 | 2;
  filters: ResolvedFilters;
  issues: Issue[];
  summary: string;
};
