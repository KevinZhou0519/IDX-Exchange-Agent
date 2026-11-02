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
  MAX_CITIES,
  PAGE_SIZE,
  createDb,
  createDbCounter,
  createMessageLog,
  createSqliteStore,
  loadVocabulary,
  marketReport,
  showListings,
  showSoldComps,
  updateSearch,
  type Extraction,
  type DbConfig,
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

const MARKET_DESCRIPTION = [
  "Market statistics for 1–3 California cities from recent sales: median price, $/sq ft, days on market, sale ÷ asking,",
  "breakdowns by home type, ZIP and month, the trend between the first and last full month, and homes for sale now.",
  "Leave `cities` out to use the city of this chat's home search. Every number in your answer must come from `reports`.",
  "Not for what similar homes sold for during a home search: use show_sold_comps for that.",
].join(" ");

const MarketSchema = Type.Object(
  {
    cities: Type.Optional(
      Type.Array(Type.String({ description: "City name only, no state (e.g. Irvine)" }), {
        maxItems: MAX_CITIES,
        description: "Cities to report on; leave out to use the city of the current home search",
      }),
    ),
  },
  { additionalProperties: false },
);

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

const NO_SESSION = {
  error: "no_session",
  instruction:
    "This conversation has no session, so the tool can't keep a search here. Tell the user to search from their WhatsApp chat or the dashboard.",
} as const;

const UNAVAILABLE = {
  error: "search_unavailable",
  instruction: "Tell the user the home data is temporarily unavailable and to try again in a moment. Do not retry now.",
} as const;

/** Runs a tool body, turning a missing session or a database failure into a plain instruction. */
async function guarded<T>(sessionKey: string | undefined, body: (key: string) => Promise<{ content: { type: "text"; text: string }[]; details: T }>) {
  if (!sessionKey) return textResult(NO_SESSION.instruction, NO_SESSION);
  try {
    return await body(sessionKey);
  } catch (error) {
    // The cause stays in the gateway log, not in the model's context.
    console.error("[idx-agent] search failed:", error);
    return textResult(UNAVAILABLE.instruction, UNAVAILABLE);
  }
}

/** The plugin always connects as the read-only user, whatever MYSQL_USER says. */
export function pluginDbConfig(): DbConfig {
  return {
    host: process.env.MYSQL_HOST ?? "localhost",
    user: "idx_user",
    password: "",
    database: process.env.MYSQL_DATABASE ?? "idx_exchange",
  };
}

/** OpenClaw's default puts every direct message in one session, so different contacts would share a search. */
export function sessionScopeWarning(config: { session?: { dmScope?: string } }): string | undefined {
  if ((config.session?.dmScope ?? "main") !== "main") return undefined;
  return (
    'idx-agent: session.dmScope is "main", so all direct messages share one saved search. ' +
    'Set session.dmScope to "per-channel-peer" before more than one person uses the agent.'
  );
}

export function createTools(deps: SearchDeps, sessionKey: string | undefined, messages?: MessageLog) {
  return {
    update_search: {
      name: "update_search",
      label: "Update home search",
      description: UPDATE_DESCRIPTION,
      parameters: ExtractionSchema,
      async execute(_toolCallId: string, params: Extraction) {
        return guarded(sessionKey, async (key) => {
          const result = await updateSearch(deps, key, params, messages?.latest(key));
          const details = { ...result, instruction: nextInstruction(result.next) };
          logForEval("update_search", key, params, details);
          const { outcome, summary, issues, next, text, instruction } = details;
          return textResult(JSON.stringify({ outcome, summary, issues, next, text, instruction }), details);
        });
      },
    },
    show_listings: {
      name: "show_listings",
      label: "Show listings",
      description: "Show a page of property cards for this chat's saved search. Use page 2, 3… when the user asks for more.",
      parameters: PageSchema,
      async execute(_toolCallId: string, params: { page: number }) {
        return guarded(sessionKey, async (key) => {
        const { total, text } = await showListings(deps, key, params.page);
        // Code Mode hands the model `details`, not `content`, so the cards go in both.
        const lastPage = total > 0 && params.page * PAGE_SIZE >= total;
        const instruction = lastPage
          ? `All ${total} results have now been shown. If the user asks for more, tell them that was all and offer to change the search; do not call show_sold_comps unless they ask about sold homes.`
          : undefined;
        const details = { total, page: params.page, text, instruction };
        logForEval("show_listings", key, params, details);
        return textResult(text, details);
        });
      },
    },
    show_sold_comps: {
      name: "show_sold_comps",
      label: "Show sold comps",
      description: "Show what similar homes recently sold for, based on this chat's saved search.",
      parameters: NoParams,
      async execute(_toolCallId: string, _params: Record<string, never>) {
        return guarded(sessionKey, async (key) => {
          const { summary, text } = await showSoldComps(deps, key);
          const details = { summary, text };
          logForEval("show_sold_comps", key, {}, details);
          return textResult(text, details);
        });
      },
    },
    market_report: {
      name: "market_report",
      label: "Market report",
      description: MARKET_DESCRIPTION,
      parameters: MarketSchema,
      async execute(_toolCallId: string, params: { cities?: string[] }) {
        return guarded(sessionKey, async (key) => {
          // Code Mode does not enforce the schema; marketReport checks the input itself.
          const result = await marketReport(deps, key, params);
          logForEval("market_report", key, params, result);
          return textResult(JSON.stringify(result), result);
        });
      },
    },
  };
}

export type IdxTools = ReturnType<typeof createTools>;
const TOOL_NAMES = ["update_search", "show_listings", "show_sold_comps", "market_report"] as const;

export default definePluginEntry({
  id: "idx-agent",
  name: "IDX Exchange Agent",
  description: "Conversational property search and market statistics over California MLS data.",
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
    const warning = sessionScopeWarning(api.config as { session?: { dmScope?: string } });
    if (warning) api.logger.warn(warning);
    const db = createDb(pluginDbConfig());
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
      api.registerTool((ctx) => createTools(deps, ctx.sessionKey, messages)[name], { name });
    }
  },
});
