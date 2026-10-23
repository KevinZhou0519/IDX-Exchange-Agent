// Runs each scripted conversation in fixtures/conversations.json through the
// real OpenClaw agent, all turns of one conversation in one session, and
// scores every turn from the tool calls it made (logged via IDX_EVAL_LOG).
//
// Usage: stop the gateway, keep the lid open, then `corepack pnpm eval:chat`
// (optionally `-- c-handbook c-more`).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGE_SIZE, type FilterField, type NextAction, type UpdateResult } from "../packages/core/src/index.ts";
import { matchesSubset } from "./lib/match-subset.ts";

type Expect = {
  tool?: "update_search" | "show_listings" | "show_sold_comps";
  next?: NextAction["action"];
  facet?: string;
  saved?: Record<string, unknown>;
  absent?: FilterField[];
  page?: number;
  noMore?: boolean;
  comps?: boolean;
};
type Conversation = { id: string; turns: { message: string; expect: Expect }[] };
type Call =
  | { tool: "update_search"; details: UpdateResult }
  | { tool: "show_listings"; details: { total: number; page: number } }
  | { tool: "show_sold_comps"; details: { summary: { count: number } | null } };

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const openclawDir = process.env.OPENCLAW_DIR ?? join(homedir(), "Developer", "openclaw");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join(repoRoot, "eval-logs", `chat-${runId}`);
mkdirSync(outDir, { recursive: true });

const only = new Set(process.argv.slice(2));
const conversations: Conversation[] = JSON.parse(readFileSync(join(repoRoot, "fixtures", "conversations.json"), "utf8"))
  .filter((c: Conversation) => only.size === 0 || only.has(c.id));

const readCalls = (path: string): Call[] =>
  existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];

/** Problems with one turn's calls against its expectation; empty means pass. */
function judge(calls: Call[], expect: Expect): string[] {
  const problems: string[] = [];
  const last = <T extends Call["tool"]>(tool: T) =>
    calls.filter((c): c is Extract<Call, { tool: T }> => c.tool === tool).at(-1);
  if (expect.tool && !calls.some((c) => c.tool === expect.tool)) problems.push(`expected a ${expect.tool} call`);
  const update = last("update_search");
  if (expect.next || expect.facet || expect.saved || expect.absent) {
    if (!update) problems.push("no update_search call");
    else {
      const next = update.details.next;
      if (expect.next && next?.action !== expect.next) problems.push(`next ${next?.action ?? "none"} ≠ ${expect.next}`);
      if (expect.facet && (next?.action !== "ask" || next.facet !== expect.facet)) problems.push(`facet ≠ ${expect.facet}`);
      if (expect.saved && !matchesSubset(update.details.saved, expect.saved)) problems.push(`saved ${JSON.stringify(update.details.saved)}`);
      for (const field of expect.absent ?? []) {
        if (update.details.saved[field] !== undefined) problems.push(`${field} still saved`);
      }
    }
  }
  const listing = last("show_listings");
  if (expect.page !== undefined && listing?.details.page !== expect.page) problems.push(`page ${listing?.details.page} ≠ ${expect.page}`);
  if (expect.noMore && !(listing && (listing.details.page - 1) * PAGE_SIZE >= listing.details.total)) problems.push("expected past the last page");
  if (expect.comps && !((last("show_sold_comps")?.details.summary?.count ?? 0) > 0)) problems.push("expected sold comps");
  return problems;
}

const results = [];
let turnPasses = 0;
let turnCount = 0;
let timeouts = 0;
for (const conversation of conversations) {
  const sessionId = `chat-${conversation.id}-${runId}`;
  const logPath = join(outDir, `${conversation.id}.jsonl`);
  const turns = [];
  for (const [index, turn] of conversation.turns.entries()) {
    const before = readCalls(logPath).length;
    const started = Date.now();
    const run = spawnSync(
      "corepack",
      ["pnpm", "openclaw", "agent", "--local", "--agent", "main", "--session-id", sessionId, "--message", turn.message, "--json"],
      { cwd: openclawDir, env: { ...process.env, IDX_EVAL_LOG: logPath }, encoding: "utf8", timeout: 300_000, stdio: ["ignore", "pipe", "pipe"] },
    );
    const calls = readCalls(logPath).slice(before);
    const timedOut = run.status === null;
    const problems = timedOut ? ["timed out"] : judge(calls, turn.expect);
    turnCount++;
    if (timedOut) timeouts++;
    if (problems.length === 0) turnPasses++;
    turns.push({ message: turn.message, tools: calls.map((c) => c.tool), problems, seconds: Math.round((Date.now() - started) / 1000) });
    const mark = timedOut ? "TIMEOUT" : problems.length ? "FAIL" : "PASS";
    console.log(`${mark} ${conversation.id} #${index + 1} "${turn.message}" → ${calls.map((c) => c.tool).join(", ") || "no tool"}${problems.length ? ` | ${problems.join("; ")}` : ""}`);
  }
  results.push({ id: conversation.id, pass: turns.every((t) => t.problems.length === 0), turns });
}

writeFileSync(join(outDir, "report.json"), JSON.stringify({ runId, results }, null, 2) + "\n");
const conversationPasses = results.filter((r) => r.pass).length;
console.log(`\nturn pass: ${turnPasses}/${turnCount}, conversation pass: ${conversationPasses}/${results.length}`);
if (timeouts > 0) console.log(`${timeouts} turn(s) timed out (machine asleep or network down); re-run them before trusting the score`);
console.log(`report: ${join(outDir, "report.json")}`);
