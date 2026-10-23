// Remembers each chat's current search, keyed by the OpenClaw session.
// A search not touched for 24 hours is forgotten.
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ResolvedFilters } from "./filters.ts";

export const SEARCH_EXPIRY_MS = 24 * 60 * 60 * 1000;

export type SavedSearch = { filters: ResolvedFilters; updatedAt: number };

export interface SearchStore {
  get(sessionKey: string): SavedSearch | undefined;
  save(sessionKey: string, filters: ResolvedFilters): void;
  clear(sessionKey: string): void;
}

const expired = (saved: SavedSearch, now: number) => now - saved.updatedAt > SEARCH_EXPIRY_MS;

/** In-process store for tests. */
export function createMemoryStore(now: () => number = Date.now): SearchStore {
  const searches = new Map<string, SavedSearch>();
  return {
    get(sessionKey) {
      const saved = searches.get(sessionKey);
      if (saved && expired(saved, now())) {
        searches.delete(sessionKey);
        return undefined;
      }
      return saved && structuredClone(saved);
    },
    save(sessionKey, filters) {
      searches.set(sessionKey, { filters: structuredClone(filters), updatedAt: now() });
    },
    clear(sessionKey) {
      searches.delete(sessionKey);
    },
  };
}

/** Store backed by a SQLite file, so searches survive gateway restarts. */
export function createSqliteStore(path: string, now: () => number = Date.now): SearchStore {
  mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE IF NOT EXISTS searches (session_key TEXT PRIMARY KEY, filters_json TEXT NOT NULL, updated_at INTEGER NOT NULL)",
  );
  const select = db.prepare("SELECT filters_json, updated_at FROM searches WHERE session_key = ?");
  const upsert = db.prepare(
    "INSERT INTO searches (session_key, filters_json, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(session_key) DO UPDATE SET filters_json = excluded.filters_json, updated_at = excluded.updated_at",
  );
  const remove = db.prepare("DELETE FROM searches WHERE session_key = ?");
  return {
    get(sessionKey) {
      const row = select.get(sessionKey) as { filters_json: string; updated_at: number } | undefined;
      if (!row) return undefined;
      const saved = { filters: JSON.parse(row.filters_json) as ResolvedFilters, updatedAt: Number(row.updated_at) };
      if (expired(saved, now())) {
        remove.run(sessionKey);
        return undefined;
      }
      return saved;
    },
    save(sessionKey, filters) {
      upsert.run(sessionKey, JSON.stringify(filters), now());
    },
    clear(sessionKey) {
      remove.run(sessionKey);
    },
  };
}
