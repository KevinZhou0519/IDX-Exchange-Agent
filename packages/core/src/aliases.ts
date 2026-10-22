// Hand-maintained mappings from everyday city names to dataset values.
// (Property types need none: the model picks the dataset's type name.)
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
