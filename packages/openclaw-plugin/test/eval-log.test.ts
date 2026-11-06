import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTools } from "../index.ts";
import { fakeDeps } from "./fake-deps.ts";

const message = { text: "condo in Irvine", attempt: 1, cities: [{ value: "Irvine", evidence: "Irvine" }] };

afterEach(() => {
  delete process.env.IDX_EVAL_LOG;
});

describe("evaluation logging", () => {
  it("appends one JSON line per tool call when IDX_EVAL_LOG is set", async () => {
    const logPath = join(mkdtempSync(join(tmpdir(), "idx-eval-")), "calls.jsonl");
    process.env.IDX_EVAL_LOG = logPath;
    const tools = createTools(fakeDeps(3), "chat-a");
    await tools.update_search.execute("t1", message);
    await tools.show_listings.execute("t2", { page: 1 });

    const lines = readFileSync(logPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ tool: "update_search", sessionKey: "chat-a", params: { text: "condo in Irvine" }, details: { outcome: "ok" } });
    expect(lines[1]).toMatchObject({ tool: "show_listings", params: { page: 1 }, details: { total: 3, text: expect.stringContaining("Showing") } });
  });

  it("writes nothing when IDX_EVAL_LOG is unset", async () => {
    const logPath = join(mkdtempSync(join(tmpdir(), "idx-eval-")), "calls.jsonl");
    await createTools(fakeDeps(3), "chat-a").update_search.execute("t1", message);
    expect(existsSync(logPath)).toBe(false);
  });
});
