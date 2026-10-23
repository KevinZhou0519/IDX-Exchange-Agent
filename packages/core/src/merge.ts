// Applies one message's changes to a chat's saved search: fields in the update
// replace saved values (lists as a whole), `remove` drops fields first, and
// `reset` starts from an empty search.
import { FILTER_FIELDS, type FilterField, type ResolvedFilters } from "./filters.ts";

export function applyUpdate(
  saved: ResolvedFilters | undefined,
  update: ResolvedFilters,
  remove: FilterField[],
  reset: boolean,
): ResolvedFilters {
  const next: ResolvedFilters = reset || !saved ? { sources: {} } : structuredClone(saved);
  for (const field of remove) {
    delete next[field];
    delete next.sources[field];
  }
  for (const field of FILTER_FIELDS) {
    if (update[field] === undefined) continue;
    (next as Record<string, unknown>)[field] = structuredClone(update[field]);
    next.sources[field] = update.sources[field] ?? "llm";
  }
  return next;
}
