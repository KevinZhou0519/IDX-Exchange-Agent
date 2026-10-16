// The filter contract shared by every week: the model's raw extraction (tool
// input) and the validated, dataset-matched result the rest of the system uses.
import { Type, type Static } from "typebox";

/** The user's own words that a value was read from. Must appear in the message. */
export const Evidence = Type.String({ minLength: 1 });

const NumberField = Type.Object({ value: Type.Number(), evidence: Evidence });
const StringItem = Type.Object({ value: Type.String({ minLength: 1 }), evidence: Evidence });
const FeatureField = Type.Object({
  value: Type.Boolean(),
  priority: Type.Union([Type.Literal("must"), Type.Literal("nice")]),
  evidence: Evidence,
});

export const ExtractionSchema = Type.Object({
  text: Type.String({ minLength: 1, description: "The user's message, verbatim" }),
  attempt: Type.Union([Type.Literal(1), Type.Literal(2)]),
  cities: Type.Optional(Type.Array(StringItem)),
  minPrice: Type.Optional(NumberField),
  maxPrice: Type.Optional(NumberField),
  minBeds: Type.Optional(NumberField),
  minBaths: Type.Optional(NumberField),
  minSqft: Type.Optional(NumberField),
  maxHoa: Type.Optional(NumberField),
  types: Type.Optional(Type.Array(StringItem)),
  excludeTypes: Type.Optional(Type.Array(StringItem)),
  pool: Type.Optional(FeatureField),
  view: Type.Optional(FeatureField),
  wishes: Type.Optional(Type.String()),
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
