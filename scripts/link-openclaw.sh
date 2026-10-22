#!/bin/bash
# Links the local OpenClaw checkout into the plugin package so
# `openclaw/plugin-sdk/*` imports resolve (tests and editor types).
# Override the checkout location with OPENCLAW_DIR.
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
openclaw_dir="${OPENCLAW_DIR:-$HOME/Developer/openclaw}"
link_dir="$repo_root/packages/openclaw-plugin/node_modules"

if ! grep -q '"name": "openclaw"' "$openclaw_dir/package.json" 2>/dev/null; then
  echo "No OpenClaw checkout at $openclaw_dir (set OPENCLAW_DIR to its path)." >&2
  exit 1
fi

mkdir -p "$link_dir"
ln -sfn "$openclaw_dir" "$link_dir/openclaw"
echo "Linked $link_dir/openclaw -> $openclaw_dir"
