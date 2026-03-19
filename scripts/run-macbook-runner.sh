#!/bin/zsh
set -euo pipefail

ROOT_DIR="/Users/moritaeiji/agent/discord-orchestrator"
BOT_DIR="$ROOT_DIR/apps/bot"
RUNNER_ENV_FILE="${RUNNER_ENV_FILE:-$BOT_DIR/.runner.env}"
NODE_BIN="${RUNNER_NODE_BIN:-/Users/moritaeiji/.nvm/versions/node/v25.2.1/bin/node}"

cd "$BOT_DIR"
export RUNNER_ENV_FILE

if [[ ! -x "$NODE_BIN" ]]; then
  echo "Runner node binary is not executable: $NODE_BIN" >&2
  exit 1
fi

exec "$NODE_BIN" \
  /Users/moritaeiji/agent/discord-orchestrator/apps/bot/node_modules/tsx/dist/cli.mjs \
  src/runner/index.ts
