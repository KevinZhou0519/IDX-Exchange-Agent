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
  ("under 1.5 mil", "3br", "irivine"). The tool rejects values whose evidence is
  not in the message.
- Cities and property types: write them as the user wrote them, typos included.
  The tool matches them against the real MLS data.
- Prices are plain dollars (`1500000` for "$1.5M"). Monthly rent is not a sale
  price.
- `pool` / `view`: `priority: "must"` for "with a pool", `"nice"` for "ideally a
  pool" or "would like a view".
- "Not a condo" goes in `excludeTypes`. Wishes no field covers ("near good
  schools", "quiet street") go in `wishes`.

## 2. Act on `outcome`

- **`ok`**: tell the user, in one sentence, what you will search for, based on
  `summary`. Invite them to change anything.
- **`needs_confirmation`**: ask the user to confirm before going further. Name
  each change from `issues`, e.g. "I read 'irivine' as Irvine" or "only 3
  listings are filed under Silver Lake; include Los Angeles too?"
- **`needs_retry`**: read `issues`, fix your extraction (correct the value or
  copy the evidence exactly), and call the tool again with `attempt: 2`.
  Never make a third call.
- **`ambiguous`**: ask one specific question built from `issues[].candidates`,
  e.g. "Did you mean Irvine (723 listings) or Arvin (3)?" Don't list more
  than three options.

When the user answers a question or corrects you, call the tool again with
their updated request (`attempt: 1`).

## 3. Stop after confirming

Searching the listings arrives in a later version. Once the filters are
confirmed, say that search results are coming soon. Don't make up listings,
prices or addresses.
