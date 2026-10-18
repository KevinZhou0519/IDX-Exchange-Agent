# IDX-Exchange Agent

A multi-agent real estate assistant built on [OpenClaw](https://github.com/openclaw/openclaw)
during the IDX Exchange AI Agentic Engineer internship. Users ask questions over
WhatsApp; the agent answers from California MLS data: active listings
(`rets_property`) and sold comps (`california_sold`) in MySQL.

## Progress

| Week | Focus | Status |
|---|---|---|
| 0 | Environment setup: OpenClaw, MySQL import, WhatsApp | Done |
| 1 | OpenClaw architecture fundamentals | Done |
| 2 | Natural-language property search | Done |
| 3 | MySQL integration (parameterized queries, pagination) | Next |
| 4 | Multi-turn conversational search | |
| 5 | Market statistics from sold comps | |
| 6 | Embeddings and semantic search | |
| 7 | Recommendation engine | |
| 8 | RAG over MLS field definitions | |
| 9 | Multi-agent orchestration | |
| 10 | WhatsApp communication layer | |
| 11 | Email agents with approval guardrails | |
| 12 | Capstone demo | |

## How it works (short version)

```text
WhatsApp → OpenClaw Gateway → session → agent loop
         → model picks a skill → skill calls a typed tool
         → parameterized SQL on MySQL → reply over WhatsApp
```

## Running it locally

Prerequisites: Node 24.16+, pnpm (via corepack), MySQL 8.4, Python 3.12.

1. Build OpenClaw from source (it is a pnpm workspace; `npm install` does not work):
   ```bash
   git clone https://github.com/openclaw/openclaw.git
   cd openclaw
   corepack pnpm install
   OPENCLAW_RUN_NODE_SKIP_DTS_BUILD=1 corepack pnpm build
   corepack pnpm openclaw onboard
   ```
2. Import the MLS dumps (provided by the program, not included in this repo):
   ```bash
   mysql -u root -e "CREATE DATABASE idx_exchange CHARACTER SET utf8mb4;"
   mysql -u root idx_exchange < rets_property.sql
   mysql -u root idx_exchange < california_sold.sql
   ```
3. Copy `.env.example` to `.env` and fill in your keys.
4. Start the Gateway and open the dashboard:
   ```bash
   corepack pnpm openclaw gateway
   corepack pnpm openclaw dashboard
   ```
5. Link WhatsApp: `corepack pnpm openclaw channels login --channel whatsapp`

## Data

The MLS data is licensed CRMLS data supplied by IDX Exchange. It is **not** in
this repository and must never be committed. `.gitignore` excludes `*.sql`
dumps and the `data/` folder.

## Repository layout

```text
packages/
  core/                    pure logic, no OpenClaw: filter format, text cleanup,
                           dataset matching, evidence/plausibility checks, outcomes
  openclaw-plugin/         OpenClaw adapter: parse_property_query tool + property-search skill
fixtures/queries.json      test queries with expected results (simulated and real-agent)
scripts/
  build-vocab.ts           export cities and property types from MySQL (local only)
  build-plugin.ts          build the self-contained folder OpenClaw installs
  link-openclaw.sh         link the local OpenClaw SDK for tests
  eval-llm.ts              run every test query through the real agent and score it
.env.example               environment variables the agent needs
```

## Development

Requires Node 24.16+ and an OpenClaw checkout at `~/Developer/openclaw`
(override with `OPENCLAW_DIR`).

| Command | What it does |
|---|---|
| `corepack pnpm install` | Install dependencies and link the OpenClaw SDK |
| `corepack pnpm test` | Unit tests (no database, no model calls) |
| `corepack pnpm typecheck` | TypeScript check |
| `corepack pnpm vocab` | Export the dataset vocabulary from MySQL into `packages/core/data/` (gitignored) |
| `corepack pnpm build:plugin` | Build `packages/openclaw-plugin/dist`; restart the gateway afterwards |
| `corepack pnpm eval` | Score the real agent on every test query (gateway stopped, lid open) |

Install the plugin once (from the OpenClaw checkout):

```bash
corepack pnpm openclaw plugins install --link "<repo>/packages/openclaw-plugin/dist"
```
