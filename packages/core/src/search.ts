// The conversational search: each message updates the chat's saved search,
// then the planner decides whether to show cards, ask a question, or suggest
// loosening a filter. The tools in the OpenClaw plugin call these three
// functions with the chat's session key.
import { formatComps, formatPage, summarizeComps, type CompsSummary, type ListingRow, type SoldRow } from "./cards.ts";
import type { Db } from "./db.ts";
import type { Extraction, ResolvedFilters, ResolveResult } from "./filters.ts";
import { applyUpdate } from "./merge.ts";
import { planNext, type Counter, type NextAction } from "./planner.ts";
import { resolveExtraction, summarize } from "./resolve.ts";
import { listingsPage, PAGE_SIZE, soldComps } from "./sql.ts";
import type { SearchStore } from "./store.ts";
import type { Vocabulary } from "./vocab.ts";

export type SearchDeps = { store: SearchStore; db: Db; counter: Counter; vocab: Vocabulary };

/** The checked update plus the whole saved search and what to do next. */
export type UpdateResult = ResolveResult & { saved: ResolvedFilters; next?: NextAction; text?: string };

const NO_SEARCH = "There's no current search yet. Tell me what you're looking for (a city, budget or type of home).";

async function pageText(deps: SearchDeps, filters: ResolvedFilters, page: number, total: number): Promise<string> {
  if (total === 0) return "No listings match the current search.";
  if ((page - 1) * PAGE_SIZE >= total) return `No more results — that was all ${total}.`;
  const rows = await deps.db.query<ListingRow>(listingsPage(filters, page));
  return formatPage(rows, page, total);
}

export async function updateSearch(deps: SearchDeps, sessionKey: string, input: Extraction): Promise<UpdateResult> {
  const resolved = resolveExtraction(input, deps.vocab);
  // resolved.filters holds only the fields that passed their checks.
  const saved = applyUpdate(deps.store.get(sessionKey)?.filters, resolved.filters, input.remove ?? [], input.reset ?? false);
  deps.store.save(sessionKey, saved);
  const result: UpdateResult = { ...resolved, saved, summary: summarize(saved) };
  if (resolved.outcome === "ok" || resolved.outcome === "needs_confirmation") {
    result.next = await planNext(saved, deps.counter);
    if (result.next.action === "show") result.text = await pageText(deps, saved, 1, result.next.total);
  }
  return result;
}

export async function showListings(
  deps: SearchDeps,
  sessionKey: string,
  page: number,
): Promise<{ total: number; text: string }> {
  const saved = deps.store.get(sessionKey);
  if (!saved) return { total: 0, text: NO_SEARCH };
  deps.store.save(sessionKey, saved.filters); // activity keeps the search alive
  const total = await deps.counter.count(saved.filters);
  return { total, text: await pageText(deps, saved.filters, page, total) };
}

export async function showSoldComps(
  deps: SearchDeps,
  sessionKey: string,
): Promise<{ summary: CompsSummary | null; text: string }> {
  const saved = deps.store.get(sessionKey);
  if (!saved) return { summary: null, text: NO_SEARCH };
  deps.store.save(sessionKey, saved.filters);
  const rows = await deps.db.query<SoldRow>(soldComps(saved.filters));
  const summary = summarizeComps(rows);
  return { summary, text: formatComps(summary, `like "${summarize(saved.filters)}"`) };
}
