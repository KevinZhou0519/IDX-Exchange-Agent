import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { Extraction } from "@idx/core";
import { fixtureVocab } from "../../core/test/fixtures/vocab.ts";
import { createParseTool } from "../index.ts";

const params: Extraction = {
  text: "condo in Irvine",
  attempt: 1,
  cities: [{ value: "Irvine", evidence: "Irvine" }],
  types: [{ value: "condo", evidence: "condo" }],
};

afterEach(() => {
  delete process.env.IDX_EVAL_LOG;
});

describe("evaluation logging", () => {
  it("appends one JSON line per call when IDX_EVAL_LOG is set", async () => {
    const logPath = join(mkdtempSync(join(tmpdir(), "idx-eval-")), "calls.jsonl");
    process.env.IDX_EVAL_LOG = logPath;
    const tool = createParseTool(fixtureVocab);
    await tool.execute("t1", params);
    await tool.execute("t2", { ...params, attempt: 2 });

    const lines = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ text: "condo in Irvine", params: { attempt: 1 }, details: { outcome: "ok" } });
    expect(lines[1].params.attempt).toBe(2);
  });

  it("writes nothing when IDX_EVAL_LOG is unset", async () => {
    const logPath = join(mkdtempSync(join(tmpdir(), "idx-eval-")), "calls.jsonl");
    await createParseTool(fixtureVocab).execute("t1", params);
    expect(existsSync(logPath)).toBe(false);
  });
});
