# Week 0: Environment setup

## Done

- [x] OpenClaw built from source and onboarded (model: Gemini 3.1 Pro)
- [x] Python environment with pandas, openai, mysql-connector-python, sqlalchemy, scikit-learn, numpy
- [x] MySQL 8.4 running locally with the `idx_exchange` database
- [x] `rets_property` imported: 55,212 rows, FULLTEXT index `ft_remarks` on `L_Remarks`
- [x] `california_sold` imported: 98,552 rows
- [x] WhatsApp linked to the Gateway; agent receives and answers messages
- [ ] OpenAI API key (needed for embeddings in Week 6)
- [ ] Email credentials (needed in Week 11)
- [ ] Read-only `idx_user` MySQL account for the agent

## Environment

| Piece | Version / location |
|---|---|
| macOS | Apple Silicon |
| Node | 24.21 (Homebrew `node@24`, keg-only) |
| pnpm | 12.5.0 via corepack |
| OpenClaw | 2026.9.6, source checkout |
| MySQL | 8.4 (Homebrew `mysql@8.4`) |
| Python | 3.12 venv |

## Problems hit and how they were solved

**`npm install` fails with `EUNSUPPORTEDPROTOCOL "workspace:"`.**
OpenClaw is a pnpm workspace; npm cannot install it. Use
`corepack pnpm install` instead.

**Node too old.** OpenClaw requires Node 24.16+ and the machine had 22.16.
Installed `node@24` with Homebrew and prepended it to `PATH` in each terminal:
`export PATH="/opt/homebrew/opt/node@24/bin:$PATH"`.

**Build fails with "Boundary input changed during compilation".**
The checkout was inside `~/Documents`, which iCloud Drive syncs. iCloud's upload
changed file metadata in `node_modules` mid-build, which OpenClaw's build
integrity check treats as fatal. Fix: keep the OpenClaw checkout (and any
`node_modules` or Python venv) outside iCloud-synced folders.

**Build fails at `check-plugin-sdk-exports`.** That step validates the public
plugin SDK type declarations before a release and failed on conflicting
`@types/node` declarations. It does not affect running OpenClaw. Use the
runtime-only build, which is also what OpenClaw's own updater runs:
`OPENCLAW_RUN_NODE_SKIP_DTS_BUILD=1 corepack pnpm build`.

**`openclaw: command not found`.** A source build does not install a global
command. Run every CLI command as `corepack pnpm openclaw <command>` from the
checkout.

**`mysql` is the wrong version.** Anaconda's `(base)` environment puts an old
MySQL 5.7 client first on `PATH`. Use
`/opt/homebrew/opt/mysql@8.4/bin/mysql` explicitly.

**MySQL not running after a restart.** It was started with
`brew services run mysql@8.4`, which does not survive a reboot. Run it again,
or use `brew services start mysql@8.4` to start it at login.

**WhatsApp: "Check your connection and try again".** The QR code rotates about
every 20 seconds; scanning one as it expires fails on the phone side. Open
WhatsApp → Linked Devices → Link a Device first, then scan the moment a fresh
code appears.

## Open questions for the mentor

- The handbook mentions over 667,000 records across both tables; the provided
  dumps contain 153,764 (55,212 + 98,552). Is this a sample, or is a larger
  export expected?
- `rets_property` has 126 columns; the handbook says 130+. Are any columns
  intentionally dropped from the export?
- A third dump, `rets_openhouse.sql`, was included but is not mentioned in the
  handbook. Is it used later?
