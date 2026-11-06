// The filter contract shared by every week: the model's raw extraction (tool
// input) and the validated, dataset-matched result the rest of the system uses.
import { Type, type Static } from "typebox";

// Unknown fields are rejected, not ignored: a model that writes
// "minSquareFeet" must get an error listing the real names, rather than
// having that filter silently dropped.
const strict = { additionalProperties: false } as const;

/** The user's own words that a value was read from. Must appear in the message. */
export const Evidence = Type.String({
  minLength: 1,
  description: "The exact words from the user's message this value came from, copied verbatim",
});

/** The dataset's property types (rets_property.L_Type_), most common first. */
export const PROPERTY_TYPES = [
  "SingleFamilyResidence", "Condominium", "Townhouse", "ManufacturedOnLand", "Duplex", "Cabin",
  "StockCooperative", "Triplex", "MixedUse", "MobileHome", "Quadruplex", "ManufacturedHome",
  "BoatSlip", "OwnYourOwn", "CoOwnership", "Farm", "Studio", "Timeshare", "Loft", "DeededParking",
] as const;

/** A whole number in dataset units: dollars, bedrooms, square feet. */
const IntField = Type.Object(
  {
    value: Type.Integer({ description: "Whole number, no symbols or units: 1500000 for \"$1.5M\", 3 for \"3br\", 0 for \"studio\"" }),
    evidence: Evidence,
  },
  strict,
);
const BathsField = Type.Object(
  {
    value: Type.Number({ description: "Bathrooms in steps of 0.5: 2.5 for \"2 and a half\" or \"2½\", 2 for \"3/2\" (beds/baths)" }),
    evidence: Evidence,
  },
  strict,
);
const CityItem = Type.Object(
  {
    value: Type.String({
      minLength: 1,
      description: "City as the user spelled it (typos included), each word capitalized: \"irivine\" → \"Irivine\", \"newport beach\" → \"Newport Beach\"",
    }),
    evidence: Evidence,
  },
  strict,
);
const TypeItem = Type.Object(
  {
    value: Type.Enum(PROPERTY_TYPES, {
        description:
        "Exactly one dataset type name: condo → Condominium; townhome → Townhouse; house, family home, single-family → SingleFamilyResidence; mobile or manufactured home → ManufacturedOnLand",
    }),
    evidence: Evidence,
  },
  strict,
);
const FeatureField = Type.Object(
  {
    value: Type.Boolean(),
    priority: Type.Union([Type.Literal("must"), Type.Literal("nice")], {
      description: '"must" for a requirement ("with a pool"), "nice" for a preference ("ideally a pool")',
    }),
    evidence: Evidence,
  },
  strict,
);

/** Every filter a search can hold; also the values allowed in `remove`. */
export const FILTER_FIELDS = [
  "cities", "minPrice", "maxPrice", "minBeds", "minBaths", "minSqft", "maxHoa",
  "types", "excludeTypes", "pool", "view", "wishes",
] as const;

export const ExtractionSchema = Type.Object({
  text: Type.String({ minLength: 1, description: "The user's message, verbatim" }),
  // An integer range, not a union of number literals: Gemini only supports
  // string enums, and OpenClaw would turn 1 | 2 into "1" | "2".
  attempt: Type.Integer({
    minimum: 1,
    maximum: 2,
    description: "1 for the first call; 2 only when retrying after outcome needs_retry",
  }),
  cities: Type.Optional(Type.Array(CityItem, { description: "One entry per city or area mentioned" })),
  minPrice: Type.Optional(IntField),
  maxPrice: Type.Optional(IntField),
  minBeds: Type.Optional(IntField),
  minBaths: Type.Optional(BathsField),
  minSqft: Type.Optional(IntField),
  maxHoa: Type.Optional(IntField),
  types: Type.Optional(
    Type.Array(TypeItem, { description: "Property types the user named; leave out for generic words like homes or place" }),
  ),
  excludeTypes: Type.Optional(
    Type.Array(TypeItem, { description: "Property types ruled out, e.g. \"not a condo\" → Condominium" }),
  ),
  pool: Type.Optional(FeatureField),
  view: Type.Optional(FeatureField),
  wishes: Type.Optional(
    Type.String({ description: "Anything the user wants that the fields above cannot express, e.g. \"near good schools\"" }),
  ),
  remove: Type.Optional(
    Type.Array(Type.Enum(FILTER_FIELDS), { description: "Filters the user wants dropped, e.g. \"forget the pool\" → [\"pool\"]" }),
  ),
  reset: Type.Optional(Type.Boolean({ description: "true when the user starts a new search (\"start over\")" })),
}, strict);

export type Extraction = Static<typeof ExtractionSchema>;

export type FilterField = (typeof FILTER_FIELDS)[number];

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
  | "auto_corrected"
  | "rental"
  | "invalid_field";

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
  attempt: number;
  filters: ResolvedFilters;
  issues: Issue[];
  summary: string;
};
