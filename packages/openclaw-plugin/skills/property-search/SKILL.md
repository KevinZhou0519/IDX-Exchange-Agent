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
- Cities and property types: write them as the user wrote them, typos included.
  The tool matches them against the real MLS data.
- Prices are plain dollars (`1500000` for "$1.5M"). Monthly rent is not a sale
  price.
- `pool` / `view`: `priority: "must"` for "with a pool", `"nice"` for "ideally a
  pool" or "would like a view".
- "Not a condo" goes in `excludeTypes`. Wishes no field covers ("near good
  schools", "quiet street") go in `wishes`.

Use exactly these field names (include only what the user mentioned):

```json
{
  "text": "<the whole message>",
  "attempt": 1,
  "cities": [{ "value": "<city as typed>", "evidence": "<exact words>" }],
  "minPrice": { "value": 0, "evidence": "<exact words>" },
  "maxPrice": { "value": 0, "evidence": "<exact words>" },
  "minBeds": { "value": 0, "evidence": "<exact words>" },
  "minBaths": { "value": 0, "evidence": "<exact words>" },
  "minSqft": { "value": 0, "evidence": "<exact words>" },
  "maxHoa": { "value": 0, "evidence": "<exact words>" },
  "types": [{ "value": "<type as typed>", "evidence": "<exact words>" }],
  "excludeTypes": [{ "value": "<type as typed>", "evidence": "<exact words>" }],
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
- **`ambiguous`**: ask one specific question built from `issues[].candidates`,
  listing at most three options with their listing counts.

If the tool call itself fails (an error instead of a result), do not guess.
Tell the user you could not process the search and ask them to rephrase it.

When the user answers a question or corrects you, call the tool again with
their updated request (`attempt: 1`).

## 3. Stop after confirming

Searching the listings arrives in a later version. Once the filters are
confirmed, say that search results are coming soon. Don't make up listings,
prices or addresses.
