// OpenClaw adapter for the IDX agent. The only file that imports OpenClaw;
// all behavior lives in @idx/core. Each tool is created per call with the
// chat's session key, so every conversation has its own saved search.
import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import {
  ExtractionSchema,
  createDb,
  createDbCounter,
  createMessageLog,
  createSqliteStore,
  loadVocabulary,
  showListings,
  showSoldComps,
  updateSearch,
  type Extraction,
  type MessageLog,
  type NextAction,
  type SearchDeps,
  type Vocabulary,
} from "@idx/core";

const UPDATE_DESCRIPTION = [
  "Update this chat's saved home search with what the user's latest message adds or changes, then get the next step.",
  "Send only fields this message mentions; earlier filters are kept. Use `remove` for filters the user drops and `reset: true` to start a new search.",
  "For every value, set `evidence` to the exact words from the message, and pass the whole message as `text`.",
  "The result has `outcome` (ok, needs_confirmation, needs_retry, ambiguous) and, when ok or needs_confirmation, `next`: show (send `text`), ask (one question using `options`), or relax (offer `suggestions`).",
].join(" ");

const PageSchema = Type.Object(
  { page: Type.Integer({ minimum: 1, description: "Page of results to show; 1 is the first 5, 2 the next 5" }) },
  { additionalProperties: false },
);
const NoParams = Type.Object({}, { additionalProperties: false });

/** Evaluation runs only (scripts/eval-*.ts). Unset by default, so user messages are never written to disk. */
function logForEval(tool: string, sessionKey: string, params: unknown, details: unknown) {
  const evalLog = process.env.IDX_EVAL_LOG;
  if (evalLog) appendFileSync(evalLog, JSON.stringify({ tool, sessionKey, params, details }) + "\n");
}

const textResult = <T,>(text: string, details: T) => ({ content: [{ type: "text" as const, text }], details });

const FACET_WORDS = { city: "the city", price: "price (their budget)", type: "the type of home", beds: "bedrooms" } as const;

/**
 * A one-line instruction for the next step, placed in `details`: in Code Mode
 * the model reads `details`, and without it a model shown cards tended to page
 * through every listing instead of asking its question.
 */
export function nextInstruction(next: NextAction | undefined): string | undefined {
  switch (next?.action) {
    case "show":
      return 'Send `text` to the user exactly as it is, then offer "more" or recent sales.';
    case "ask":
      return `Ask the user one question about ${FACET_WORDS[next.facet]} using \`options\` and \`total\`. Do not call show_listings until they answer or ask for listings.`;
    case "relax":
      return "Offer `suggestions` to the user (or say nothing matches if there are none). Do not call other tools.";
    default:
      return undefined;
  }
}

/** Records a real inbound message for its chat (OpenClaw's message_received hook). */
export function recordInbound(
  messages: MessageLog,
  event: { content: string; sessionKey?: string },
  ctx: { sessionKey?: string },
) {
  const sessionKey = event.sessionKey ?? ctx.sessionKey;
  if (sessionKey && event.content) messages.record(sessionKey, event.content);
}

export function createTools(deps: SearchDeps, sessionKey: string, messages?: MessageLog) {
  return {
    update_search: {
      name: "update_search",
      label: "Update home search",
      description: UPDATE_DESCRIPTION,
      parameters: ExtractionSchema,
      async execute(_toolCallId: string, params: Extraction) {
        const result = await updateSearch(deps, sessionKey, params, messages?.latest(sessionKey));
        const details = { ...result, instruction: nextInstruction(result.next) };
        logForEval("update_search", sessionKey, params, details);
        const { outcome, summary, issues, next, text, instruction } = details;
        return textResult(JSON.stringify({ outcome, summary, issues, next, text, instruction }), details);
      },
    },
    show_listings: {
      name: "show_listings",
      label: "Show listings",
      description: "Show a page of property cards for this chat's saved search. Use page 2, 3… when the user asks for more.",
      parameters: PageSchema,
      async execute(_toolCallId: string, params: { page: number }) {
        const { total, text } = await showListings(deps, sessionKey, params.page);
        // Code Mode hands the model `details`, not `content`, so the cards go in both.
        const details = { total, page: params.page, text };
        logForEval("show_listings", sessionKey, params, details);
        return textResult(text, details);
      },
    },
    show_sold_comps: {
      name: "show_sold_comps",
      label: "Show sold comps",
      description: "Show what similar homes recently sold for, based on this chat's saved search.",
      parameters: NoParams,
      async execute(_toolCallId: string, _params: Record<string, never>) {
        const { summary, text } = await showSoldComps(deps, sessionKey);
        const details = { summary, text };
        logForEval("show_sold_comps", sessionKey, {}, details);
        return textResult(text, details);
      },
    },
  };
}

export type IdxTools = ReturnType<typeof createTools>;
const TOOL_NAMES = ["update_search", "show_listings", "show_sold_comps"] as const;

export default definePluginEntry({
  id: "idx-agent",
  name: "IDX Exchange Agent",
  description: "Conversational property search over California MLS data.",
  register(api) {
    // The build copies the vocabulary next to the bundle (dist/data/vocab.json).
    // Loaded once at startup; throws with the command to run if it is missing.
    const vocabPath = fileURLToPath(new URL("./data/vocab.json", import.meta.url));
    let vocab: Vocabulary;
    try {
      vocab = loadVocabulary(vocabPath);
    } catch (error) {
      throw new Error(
        `IDX agent: dataset vocabulary missing at ${vocabPath}. From the IDX-Exchange-Agent repo run ` +
          "`corepack pnpm vocab && corepack pnpm build:plugin`, then restart the gateway.",
        { cause: error },
      );
    }
    const stateDir = process.env.IDX_STATE_DIR ?? join(homedir(), ".openclaw", "idx-agent");
    const db = createDb();
    const deps: SearchDeps = {
      store: createSqliteStore(join(stateDir, "searches.sqlite")),
      db,
      counter: createDbCounter(db),
      vocab,
    };
    // Needs channels.whatsapp.pluginHooks.messageReceived: true to receive
    // WhatsApp messages; without it, quotes are checked against the model's copy.
    const messages = createMessageLog();
    api.on("message_received", (event, ctx) => recordInbound(messages, event, ctx));
    for (const name of TOOL_NAMES) {
      api.registerTool((ctx) => createTools(deps, ctx.sessionKey ?? "default", messages)[name], { name });
    }
  },
});
