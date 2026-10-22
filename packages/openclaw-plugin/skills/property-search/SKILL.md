---
name: property-search
description: Use when the user wants to find, search, browse or shop for homes, houses, condos, townhomes or listings for sale in California, or describes a home they are looking for (city, budget, bedrooms, pool, HOA, etc.).
---

# Property search

Turn the user's home-search request into validated search filters with the
`parse_property_query` tool, then confirm what you understood.

## 1. Extract and call the tool

Call `parse_property_query` once with `attempt: 1`:

- `text`: the user's whole message, verbatim.
- Fill only fields the user actually mentioned. Never invent a budget, city or
  bedroom count.
- `evidence` on every field: the exact words from the message, copied verbatim
  (for "under 1.5 mil", the evidence is `under 1.5 mil`). The tool rejects
  values whose evidence is not in the message.

## Output format (matches the MLS data exactly)

| Field | Format | Examples |
|---|---|---|
| `cities` | The user's spelling (typos included), each word capitalized | "irivine" → `Irivine`; "newport beach" → `Newport Beach` |
| `types` / `excludeTypes` | Exactly one dataset type name | condo → `Condominium`; townhome → `Townhouse`; house, family home, single-family → `SingleFamilyResidence`; duplex → `Duplex`; mobile or manufactured home → `ManufacturedOnLand` |
| `minPrice` / `maxPrice` | Whole dollars, no symbols | "$1.5M" → `1500000`; "800k" → `800000`; "under a million" → `1000000` |
| `minBeds` | Whole number | "3br" → `3`; "studio" → `0` |
| `minBaths` | Steps of 0.5 | "2 and a half" or "2½" → `2.5`; "3/2" (beds/baths) → `2` |
| `minSqft` | Whole number | "1,800 sq ft" → `1800` |
| `maxHoa` | Whole dollars per month | "HOA under $500" → `500` |
| `pool` / `view` | `true` / `false` | "no pool" → `false` |

- The tool corrects city typos against the data, so keep the user's spelling.
- Generic words alone ("homes", "a place", "property") mean any type: leave
  `types` out. "Studio" means 0 bedrooms, not a type.
- For a range like "1 to 2 million", use the whole phrase as the evidence for
  both `minPrice` and `maxPrice`. Monthly rent is not a sale price.
- `pool` / `view`: `priority: "must"` for "with a pool", `"nice"` for "ideally a
  pool" or "would like a view".
- "Not a condo" goes in `excludeTypes`. Wishes no field covers ("near good
  schools", "quiet street") go in `wishes`.

Use exactly these field names (include only what the user mentioned):

```json
{
  "text": "<the whole message>",
  "attempt": 1,
  "cities": [{ "value": "Irivine", "evidence": "<exact words>" }],
  "minPrice": { "value": 800000, "evidence": "<exact words>" },
  "maxPrice": { "value": 1500000, "evidence": "<exact words>" },
  "minBeds": { "value": 3, "evidence": "<exact words>" },
  "minBaths": { "value": 2.5, "evidence": "<exact words>" },
  "minSqft": { "value": 1800, "evidence": "<exact words>" },
  "maxHoa": { "value": 500, "evidence": "<exact words>" },
  "types": [{ "value": "Condominium", "evidence": "<exact words>" }],
  "excludeTypes": [{ "value": "Townhouse", "evidence": "<exact words>" }],
  "pool": { "value": true, "priority": "must", "evidence": "<exact words>" },
  "view": { "value": true, "priority": "nice", "evidence": "<exact words>" },
  "wishes": "<anything else they want>"
}
```

## 2. Act on `outcome`

Everything you tell the user about their search must come from a successful
`parse_property_query` result: its `outcome`, `summary` and `issues`. Never
describe filters, corrections or listing counts the tool did not return.

- **`ok`**: tell the user, in one sentence, what you will search for, based on
  `summary`. Invite them to change anything.
- **`needs_confirmation`**: name each item in `issues` in plain words, e.g. "I
  read <what they typed> as <matched city>", or "only <n> listings are filed
  under <city>". Then state the search from `summary` and end your reply with
  a direct yes/no question asking them to confirm. Do not continue until they
  answer.
- **`needs_retry`**: read `issues`, fix your extraction (correct the value or
  copy the evidence exactly), and call the tool again with `attempt: 2`.
  Never make a third call. A retry may correct a value but must keep every
  field the user asked for: never drop a city, price or other filter to make
  an issue go away. If you cannot fix it, send it unchanged so the tool returns
  `ambiguous`, then ask the user about it.
- **`ambiguous`**: if an issue has `kind: "rental"`, explain that the listings
  are homes for sale and ask whether they want to buy instead. Otherwise ask one
  specific question built from `issues[].candidates` (at most three options,
  with listing counts), or, when an issue has no candidates, about the value
  it quotes.

If the tool call itself fails (an error instead of a result), do not guess.
Tell the user you could not process the search and ask them to rephrase it.

When the user answers a question or corrects you, call the tool again with
their updated request (`attempt: 1`).

## 3. Stop after confirming

Searching the listings arrives in a later version. Once the filters are
confirmed, say that search results are coming soon. Don't make up listings,
prices or addresses.
