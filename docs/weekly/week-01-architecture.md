# Week 1: OpenClaw architecture fundamentals

**Deliverable:** architecture documentation with a workflow diagram showing how
user queries flow from WhatsApp through OpenClaw skills to the MLS databases.
See [../architecture.md](../architecture.md).

## What I learned

- **The Gateway is the runtime.** One process per machine owns the WhatsApp
  connection, sessions and agent runs. Everything else (dashboard, CLI, TUI)
  is a client talking to it over a local WebSocket on port 18789.
- **Skills are prompts, not code.** A skill is a `SKILL.md` file. OpenClaw lists
  the eligible skills in the system prompt and the model picks one. The quality
  of each skill's description decides whether routing works.
- **Tools are where code lives.** Typed functions are registered by plugins with
  a TypeBox parameter schema. OpenClaw validates the model's arguments before
  running the tool. Database access belongs here, not in the prompt.
- **Runs are serialized per session.** Two quick messages from the same user
  cannot race each other; the second waits or steers the first.
- **Sessions are shared across DMs by default.** Fine for a single developer,
  but a client-facing assistant must isolate sessions per sender
  (`session.dmScope: "per-channel-peer"`), or one client's search history leaks
  into another's conversation.
- **Memory has two layers.** The session transcript is automatic (SQLite).
  Long-term memory is Markdown in the agent workspace, written deliberately and
  loaded at the start of a session.
- **Hooks are the safety layer.** `before_tool_call` can block or gate a tool,
  which is how the Week 11 email approval step will work.

## Differences from the handbook's mental model

The handbook's example dispatches on `message.includes("time")`. In OpenClaw the
model decides which tool to call from the tool's name, description and schema,
so the work shifts from writing routing code to writing precise tool and skill
descriptions. Details in the architecture doc's comparison table.

## Next week

Week 2: a `property-search` skill that turns free-text queries into a
structured filter object, validated against at least 10 test queries.
