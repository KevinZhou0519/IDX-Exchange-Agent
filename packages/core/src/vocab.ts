// The dataset's real values (cities and property types with listing counts).
// Generated from MySQL by `corepack pnpm vocab`; never committed.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Vocabulary = {
  generatedAt: string;
  cities: { name: string; activeListings: number; soldCount: number }[];
  types: { name: string; activeListings: number }[];
};

export const DEFAULT_VOCAB_PATH = fileURLToPath(new URL("../data/vocab.json", import.meta.url));

export function loadVocabulary(path: string = DEFAULT_VOCAB_PATH): Vocabulary {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(
      `Dataset vocabulary not found at ${path}. Build it from MySQL with: corepack pnpm vocab`,
      { cause: error },
    );
  }
  return JSON.parse(raw) as Vocabulary;
}
