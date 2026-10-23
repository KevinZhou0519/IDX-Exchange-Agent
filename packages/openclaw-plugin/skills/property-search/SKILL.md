---
name: property-search
description: Use when the user wants to find, search, browse or shop for homes, houses, condos, townhomes or listings for sale in California, refines a search (budget, type, bedrooms, pool, HOA, "more", "start over"), or asks what similar homes sold for.
---

# Property search

Each chat has one saved home search. Every message the user sends about homes
updates it with `update_search`; the tool searches the real MLS data and says
what to do next. Use `show_listings` for more results and `show_sold_comps` for
recent sales.

## 1. Send only what this message changes

Call `update_search` with `attempt: 1`:

- `text`: the user's whole message, verbatim.
- Only fields **this message** mentions. Earlier filters are already saved; do
  not repeat them. Never invent a budget, city or bedroom count.
- `remove`: filters the user drops ("forget the pool" → `["pool"]`, "any price"
  → `["minPrice", "maxPrice"]`).
- `reset: true`: the user starts a new search ("start over", "new search").
- `evidence` on every field: the exact words from this message, copied verbatim
  (for "under 1.5 mil", the evidence is `under 1.5 mil`). The tool rejects
  values whose evidence is not in the message.
- An answer to your question is a change too: after "What's your budget?",
  "1.2M" → `maxPrice: { value: 1200000, evidence: "1.2M" }`.

## Output format (matches the MLS data exactly)

| Field | Format | Examples |
|---|---|---|
| `cities` | City name only, no state; the user's spelling (typos included), each word capitalized | "Irvine, CA" → `Irvine`; "irivine" → `Irivine`; "newport beach" → `Newport Beach` |
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

Use exactly these field names (include only what this message mentions):

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
  "wishes": "<anything else they want>",
  "remove": ["pool"],
  "reset": false
}
```

## 2. Act on `outcome`

Everything you tell the user about their search must come from a successful
tool result. Never describe filters, corrections, counts, listings, prices or
addresses a tool did not return.

- **`ok`**: act on `next` (section 3).
- **`needs_confirmation`**: name each item in `issues` in plain words, e.g. "I
  read <what they typed> as <matched city>", or "only <n> listings are filed
  under <city>". Then end with a direct yes/no question. When they say yes, act
  on `next` from that result (call `show_listings` with page 1 if it said
  show).
- **`needs_retry`**: read `issues`, fix your extraction (correct the value or
  copy the evidence exactly), and call `update_search` again with
  `attempt: 2`. Never a third call. A retry may correct a value but must keep
  every field the user asked for: never drop a city, price or other filter to
  make an issue go away. If you cannot fix it, send it unchanged so the tool
  returns `ambiguous`, then ask the user about it.
- **`ambiguous`**: if an issue has `kind: "rental"`, explain that the listings
  are homes for sale and ask whether they want to buy instead. Otherwise ask one
  specific question built from `issues[].candidates` (at most three options,
  with listing counts), or, when an issue has no candidates, about the value it
  quotes.

If a tool call fails (an error instead of a result), do not guess. Tell the
user you could not process it and ask them to rephrase.

## 3. Act on `next`

- **`show`**: send `text` exactly as the tool returned it (it already contains
  the cards). Then offer: "more" for the next 5, or what similar homes sold for.
- **`ask`**: tell the user how many homes match (`total`) and ask **one**
  question about `facet`, listing the `options` with their numbers, e.g. "208
  homes left: Condominium (163), Townhouse (26), SingleFamilyResidence (12).
  Which type?" Use plain words for type names (single-family home, condo).
  For `price`, say what share of homes are under each price point.
- **`relax`**: nothing matches. Offer each item in `suggestions` with its
  number, e.g. "Without the price limit there are 14." If `suggestions` is
  empty, say nothing is listed for that search and ask what to change.

## 4. More results and sold homes

- "More", "next", "show more" → always `show_listings` with the next page
  number (page 2 after the first results, then 3…), even when you think every
  result was shown: the tool says when there are no more. Send its text as
  returned, and do not call any other tool for "more".
- "What did similar homes sell for?", "recent sales", "comps" →
  `show_sold_comps`. Send its text as returned.
