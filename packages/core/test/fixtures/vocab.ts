import { fileURLToPath } from "node:url";
import { loadVocabulary } from "../../src/index.ts";

export const fixtureVocabPath = fileURLToPath(new URL("./vocab.fixture.json", import.meta.url));
export const fixtureVocab = loadVocabulary(fixtureVocabPath);
