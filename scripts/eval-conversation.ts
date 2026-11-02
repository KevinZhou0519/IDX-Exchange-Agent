// Runs each scripted conversation in a fixture (default
// fixtures/conversations.json) through the real OpenClaw agent, all turns of
// one conversation in one session, and scores every turn from the tool calls
// it made (logged via IDX_EVAL_LOG) and from its reply.
//
// Usage: stop the gateway, keep the lid open, then `corepack pnpm eval:chat`
// or `corepack pnpm eval:market` (optionally `-- c-handbook c-more`).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGE_SIZE, type FilterField, type MarketResult, type NextAction, type UpdateResult } from "../packages/core/src/index.ts";
import { ungrounded } from "./lib/grounded.ts";
import { matchesSubset } from "./lib/match-subset.ts";
import { replyText } from "./lib/reply-text.ts";

type Expect = {
  tool?: "update_search" | "show_listings" | "show_sold_comps" | "market_report";
  next?: NextAction["action"];
  facet?: string;
  saved?: Record<string, unknown>;
  absent?: FilterField[];
  page?: number;
  noMore?: boolean;
  comps?: boolean;
  /** The last market_report call's outcome, and the cities its reports cover. */
  market?: { outcome?: MarketResult["outcome"]; cities?: string[] };
  /** No market_report call this turn (sensitive questions). */
  noMarket?: boolean;
  /** The reply declines (part of) the question. */
  declines?: boolean;
  /** The reply starts with the "I can't tell you whether to buy/sell" disclaimer. */
  disclaimer?: boolean;
  /** The reply has an "In short:" summary. */
  summary?: boolean;
  /** A case-insensitive pattern the reply must match. */
  says?: string;
};
type Conversation = { id: string; turns: { message: string; expect: Expect }[] };
type Call =
  | { tool: "update_search"; details: UpdateResult }
  | { tool: "show_listings"; details: { total: number; page: number } }
  | { tool: "show_sold_comps"; details: { summary: { count: number } | null } }
  | { tool: "market_report"; details: MarketResult };

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const openclawDir = process.env.OPENCLAW_DIR ?? join(homedir(), "Developer", "openclaw");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join(repoRoot, "eval-logs", `chat-${runId}`);
mkdirSync(outDir, { recursive: true });

const args = process.argv.slice(2);
const fixtureFlag = args.indexOf("--fixture");
const fixture = fixtureFlag >= 0 ? args.splice(fixtureFlag, 2)[1] : "conversations.json";
const only = new Set(args);
const conversations: Conversation[] = JSON.parse(readFileSync(join(repoRoot, "fixtures", fixture), "utf8"))
  .filter((c: Conversation) => only.size === 0 || only.has(c.id));

const readCalls = (path: string): Call[] =>
  existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)) : [];

/** More tool calls than this in one turn means the model is looping. */
const MAX_CALLS_PER_TURN = 3;

const DECLINE = /\b(?:can(?:'|’)?t|cannot|can not|unable to|not able to|won(?:'|’)?t) (?:\w+ ){0,4}?(?:help|share|answer|provide|discuss|ignore)|\bcan only (?:answer|help)/i;
const DISCLAIMER = /^[\s*_#>]*I can(?:'|’)?t tell you whether to (?:buy|sell)/i;

/**
 * Problems with one turn's calls and reply against its expectation; empty
 * means pass. `sources` is every tool result and user message of the
 * conversation so far: market numbers in a reply must come from them.
 */
function judge(calls: Call[], expect: Expect, reply: string, sources: unknown[], marketSoFar: boolean): string[] {
  const problems: string[] = [];
  if (calls.length > MAX_CALLS_PER_TURN) problems.push(`${calls.length} tool calls (looping?)`);
  const last = <T extends Call["tool"]>(tool: T) =>
    calls.filter((c): c is Extract<Call, { tool: T }> => c.tool === tool).at(-1);
  // Past the last page, either paging again or simply saying so is correct.
  const saidNoMore = calls.length === 0 && /no more|that was all|that's all|all \d+ (results|homes|listings)|already (seen|shown)/i.test(reply);
  if (expect.noMore && saidNoMore) return problems;
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
  const market = last("market_report");
  if (expect.market) {
    if (!market) problems.push("no market_report call");
    else {
      if (expect.market.outcome && market.details.outcome !== expect.market.outcome) problems.push(`outcome ${market.details.outcome} ≠ ${expect.market.outcome}`);
      const cities = market.details.reports.map((r) => r.city);
      if (expect.market.cities && cities.join() !== expect.market.cities.join()) problems.push(`report cities ${cities.join(", ") || "none"}`);
    }
  }
  if (expect.noMarket && market) problems.push("market_report called on a sensitive question");
  if (expect.declines && !DECLINE.test(reply)) problems.push("reply does not decline");
  if (expect.disclaimer && !DISCLAIMER.test(reply)) problems.push("reply does not start with the disclaimer");
  if (expect.summary && !/\bIn short\b/i.test(reply)) problems.push("no \"In short\" summary");
  if (expect.says && !new RegExp(expect.says, "i").test(reply)) problems.push(`reply does not match /${expect.says}/`);
  if (marketSoFar || expect.declines) {
    const made = ungrounded(reply, sources);
    if (made.length) problems.push(`numbers not in any tool result: ${made.join(", ")}`);
  }
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
  const messages: string[] = [];
  for (const [index, turn] of conversation.turns.entries()) {
    messages.push(turn.message);
    const before = readCalls(logPath).length;
    const started = Date.now();
    const run = spawnSync(
      "corepack",
      ["pnpm", "openclaw", "agent", "--local", "--agent", "main", "--session-id", sessionId, "--message", turn.message, "--json"],
      { cwd: openclawDir, env: { ...process.env, IDX_EVAL_LOG: logPath }, encoding: "utf8", timeout: 300_000, stdio: ["ignore", "pipe", "pipe"] },
    );
    const calls = readCalls(logPath).slice(before);
    const timedOut = run.status === null;
    const reply = replyText(run.stdout ?? "");
    const soFar = readCalls(logPath);
    const sources = [...soFar.map((c) => c.details), ...messages];
    const marketSoFar = soFar.some((c) => c.tool === "market_report");
    const problems = timedOut ? ["timed out"] : judge(calls, turn.expect, reply, sources, marketSoFar);
    turnCount++;
    if (timedOut) timeouts++;
    if (problems.length === 0) turnPasses++;
    turns.push({ message: turn.message, tools: calls.map((c) => c.tool), problems, reply, seconds: Math.round((Date.now() - started) / 1000) });
    const mark = timedOut ? "TIMEOUT" : problems.length ? "FAIL" : "PASS";
    console.log(`${mark} ${conversation.id} #${index + 1} "${turn.message}" → ${calls.map((c) => c.tool).join(", ") || "no tool"}${problems.length ? ` | ${problems.join("; ")}` : ""}`);
  }
  results.push({ id: conversation.id, pass: turns.every((t) => t.problems.length === 0), turns });
}

writeFileSync(join(outDir, "report.json"), JSON.stringify({ runId, fixture, results }, null, 2) + "\n");
const conversationPasses = results.filter((r) => r.pass).length;
console.log(`\nturn pass: ${turnPasses}/${turnCount}, conversation pass: ${conversationPasses}/${results.length}`);
if (timeouts > 0) console.log(`${timeouts} turn(s) timed out (machine asleep or network down); re-run them before trusting the score`);
console.log(`report: ${join(outDir, "report.json")}`);
