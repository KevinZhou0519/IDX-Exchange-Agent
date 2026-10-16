// OpenClaw adapter for the IDX agent. The only file that imports OpenClaw;
// all behavior lives in @idx/core.
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import {
  ExtractionSchema,
  loadVocabulary,
  resolveExtraction,
  type Extraction,
  type ResolveResult,
  type Vocabulary,
} from "@idx/core";

const PARSE_DESCRIPTION = [
  "Turn a home-search request into validated MLS search filters.",
  "Fill only the fields the user actually mentioned. For every value, set `evidence` to the exact words from the user's message it came from, copied verbatim, and pass the full message as `text`.",
  "Write city and type values the way the user wrote them (typos included); the tool matches them to the real data.",
  "The result's `outcome` says what to do next: ok, needs_confirmation, needs_retry (call again once with attempt 2, using `issues`), or ambiguous (ask the user).",
].join(" ");

export function createParseTool(vocab: Vocabulary) {
  return {
    name: "parse_property_query",
    label: "Parse property search",
    description: PARSE_DESCRIPTION,
    parameters: ExtractionSchema,
    async execute(_toolCallId: string, params: Extraction) {
      const details: ResolveResult = resolveExtraction(params, vocab);
      // Evaluation runs only (scripts/eval-llm.ts). Unset by default, so user
      // messages are never written to disk in normal use.
      const evalLog = process.env.IDX_EVAL_LOG;
      if (evalLog) appendFileSync(evalLog, JSON.stringify({ text: params.text, params, details }) + "\n");
      const { outcome, summary, issues } = details;
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ outcome, summary, issues }) }],
        details,
      };
    },
  };
}

export default definePluginEntry({
  id: "idx-agent",
  name: "IDX Exchange Agent",
  description: "Natural-language property search over California MLS data.",
  register(api) {
    // The build copies the vocabulary next to the bundle (dist/data/vocab.json).
    // Loaded once at startup; throws with the command to run if it is missing.
    const vocabPath = fileURLToPath(new URL("./data/vocab.json", import.meta.url));
    api.registerTool(createParseTool(loadVocabulary(vocabPath)));
  },
});
