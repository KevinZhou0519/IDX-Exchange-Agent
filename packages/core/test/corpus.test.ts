import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  resolveExtraction,
  type Extraction,
  type IssueKind,
  type Outcome,
  type ResolvedFilters,
} from "../src/index.ts";
import { fixtureVocab } from "./fixtures/vocab.ts";

type CorpusEntry = {
  id: string;
  text: string;
  extraction: Extraction;
  expect: { outcome: Outcome; filters?: Partial<ResolvedFilters>; issueKinds?: IssueKind[] };
};

const corpus: CorpusEntry[] = JSON.parse(
  readFileSync(new URL("../../../fixtures/queries.json", import.meta.url), "utf8"),
);

describe("query corpus", () => {
  it("has at least 17 queries", () => {
    expect(corpus.length).toBeGreaterThanOrEqual(17);
  });

  it.each(corpus.map((entry) => [entry.id, entry] as const))("%s", (_id, entry) => {
    const result = resolveExtraction(entry.extraction, fixtureVocab);
    expect(result.outcome).toBe(entry.expect.outcome);
    if (entry.expect.filters) expect(result.filters).toMatchObject(entry.expect.filters);
    const kinds = [...new Set(result.issues.map((issue) => issue.kind))].sort();
    expect(kinds).toEqual([...new Set(entry.expect.issueKinds ?? [])].sort());
  });
});
