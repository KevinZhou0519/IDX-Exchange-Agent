// Runs every query in fixtures/queries.json through the real OpenClaw agent
// (model + plugin) and scores the final update_search result of each
// turn against the query's `agent` expectation.
//
// Usage: stop the gateway, keep the lid open, then `corepack pnpm eval` (optionally
// `-- q-handbook q-tie-irvin`). The npm script wraps it in `caffeinate -i` on macOS.
// Needs the plugin installed and built (corepack pnpm build:plugin).
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Outcome, ResolveResult } from "../packages/core/src/index.ts";
import { matchesSubset } from "./lib/match-subset.ts";

type AgentExpect = { outcomes?: Outcome[]; filters?: Record<string, unknown>; note?: string; skip?: string };
type Entry = { id: string; text: string; agent: AgentExpect };
type LoggedCall = { tool: string; sessionKey: string; params: unknown; details: ResolveResult };

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const openclawDir = process.env.OPENCLAW_DIR ?? join(homedir(), "Developer", "openclaw");
const runId = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = join(repoRoot, "eval-logs", runId);
mkdirSync(outDir, { recursive: true });

const only = new Set(process.argv.slice(2));
const corpus: Entry[] = JSON.parse(readFileSync(join(repoRoot, "fixtures", "queries.json"), "utf8"));
const entries = corpus.filter((entry) => !entry.agent.skip && (only.size === 0 || only.has(entry.id)));

function replyText(stdout: string): string {
  const start = stdout.indexOf("{");
  if (start < 0) return "";
  try {
    const envelope = JSON.parse(stdout.slice(start)) as { payloads?: { text?: string }[] };
    return (envelope.payloads ?? []).map((payload) => payload.text ?? "").join(" ").trim();
  } catch {
    return "";
  }
}

const results = [];
for (const [index, entry] of entries.entries()) {
  const logPath = join(outDir, `${entry.id}.jsonl`);
  const started = Date.now();
  const run = spawnSync(
    "corepack",
    ["pnpm", "openclaw", "agent", "--local", "--agent", "main", "--session-id", `eval-${entry.id}-${runId}`, "--message", entry.text, "--json"],
    { cwd: openclawDir, env: { ...process.env, IDX_EVAL_LOG: logPath }, encoding: "utf8", timeout: 300_000, stdio: ["ignore", "pipe", "pipe"] },
  );
  const calls: LoggedCall[] = existsSync(logPath)
    ? readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as LoggedCall)
        .filter((call) => call.tool === "update_search")
    : [];
  const final = calls.at(-1)?.details;
  const outcomePass = Boolean(final && entry.agent.outcomes?.includes(final.outcome));
  const fieldsChecked = entry.agent.filters !== undefined;
  const fieldsPass = fieldsChecked ? Boolean(final && matchesSubset(final.filters, entry.agent.filters)) : null;
  const result = {
    id: entry.id,
    text: entry.text,
    expectedOutcomes: entry.agent.outcomes,
    finalOutcome: final?.outcome ?? "no tool call",
    toolCalls: calls.length,
    outcomePass,
    fieldsPass,
    summary: final?.summary,
    issues: final?.issues.map((issue) => issue.message),
    reply: replyText(run.stdout ?? ""),
    exitCode: run.status,
    timedOut: run.status === null,
    seconds: Math.round((Date.now() - started) / 1000),
  };
  results.push(result);
  // spawnSync reports a null exit status when the timeout killed the run (e.g. the Mac slept).
  const timedOut = run.status === null;
  const mark = timedOut ? "TIMEOUT" : outcomePass && fieldsPass !== false ? "PASS" : "FAIL";
  console.log(`[${index + 1}/${entries.length}] ${mark} ${entry.id}: ${result.finalOutcome} (${calls.length} call${calls.length === 1 ? "" : "s"}, ${result.seconds}s)`);
}

const timeouts = results.filter((r) => r.timedOut).length;
const outcomePasses = results.filter((r) => r.outcomePass).length;
const fieldResults = results.filter((r) => r.fieldsPass !== null);
const fieldPasses = fieldResults.filter((r) => r.fieldsPass).length;
writeFileSync(join(outDir, "report.json"), JSON.stringify({ runId, results }, null, 2) + "\n");
console.log(`\noutcome pass: ${outcomePasses}/${results.length}, field pass: ${fieldPasses}/${fieldResults.length}`);
if (timeouts > 0) console.log(`${timeouts} run(s) timed out (machine asleep or network down); re-run them before trusting the score`);
console.log(`report: ${join(outDir, "report.json")}`);
