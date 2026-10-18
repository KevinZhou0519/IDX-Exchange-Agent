// Hand-maintained mappings from everyday words to dataset values.
// Keys are written naturally and normalized on lookup.

/** City nicknames and alternate spellings → every dataset name for that place. */
export const CITY_ALIASES: Record<string, string[]> = {
  "la": ["Los Angeles"],
  "l a": ["Los Angeles"],
  "los angeles": ["Los Angeles"],
  "sd": ["San Diego"],
  "29 palms": ["29 Palms", "Twentynine Palms"],
  "twentynine palms": ["29 Palms", "Twentynine Palms"],
};

/** Everyday property words → the dataset's L_Type_ value. */
export const TYPE_SYNONYMS: Record<string, string> = {
  "condo": "Condominium",
  "condos": "Condominium",
  "condominium": "Condominium",
  "townhome": "Townhouse",
  "townhomes": "Townhouse",
  "townhouse": "Townhouse",
  "town house": "Townhouse",
  "house": "SingleFamilyResidence",
  "houses": "SingleFamilyResidence",
  "single family": "SingleFamilyResidence",
  "single-family": "SingleFamilyResidence",
  "single family home": "SingleFamilyResidence",
  "single family homes": "SingleFamilyResidence",
  "family home": "SingleFamilyResidence",
  "family homes": "SingleFamilyResidence",
  "sfr": "SingleFamilyResidence",
  "duplex": "Duplex",
  "manufactured": "ManufacturedOnLand",
  "mobile home": "ManufacturedOnLand",
};

/** Words for "any property": they set no type filter ("homes in Irvine" includes condos). */
export const GENERIC_TYPE_WORDS = new Set([
  "home", "homes", "place", "places", "property", "properties", "listing", "listings",
  "real estate", "somewhere", "something",
]);
