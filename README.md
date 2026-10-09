# IDX-Exchange Agent

A multi-agent real estate assistant built on [OpenClaw](https://github.com/openclaw/openclaw)
during the IDX Exchange AI Agentic Engineer internship. Users ask questions over
WhatsApp; the agent answers from California MLS data: active listings
(`rets_property`) and sold comps (`california_sold`) in MySQL.

**Architecture and workflow diagrams:** [docs/architecture.md](docs/architecture.md)

## Progress

| Week | Focus | Status |
|---|---|---|
| 0 | Environment setup: OpenClaw, MySQL import, WhatsApp | Done ([notes](docs/weekly/week-00-setup.md)) |
| 1 | OpenClaw architecture fundamentals | Done ([notes](docs/weekly/week-01-architecture.md)) |
| 2 | Natural-language property search | Next |
| 3 | MySQL integration (parameterized queries, pagination) | |
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

The full flow, component table and design decisions are in
[docs/architecture.md](docs/architecture.md).

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

Setup problems and fixes: [docs/weekly/week-00-setup.md](docs/weekly/week-00-setup.md).

## Data

The MLS data is licensed CRMLS data supplied by IDX Exchange. It is **not** in
this repository and must never be committed. `.gitignore` excludes `*.sql`
dumps and the `data/` folder.

## Repository layout

```text
docs/
  architecture.md          system and sequence diagrams, design decisions
  weekly/                  one progress note per week
.env.example               environment variables the agent needs
```

Skills, plugin tools and scripts are added from Week 2 onward.
