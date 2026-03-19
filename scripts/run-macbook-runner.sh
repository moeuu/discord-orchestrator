#!/bin/zsh
set -euo pipefail

ROOT_DIR="/Users/moritaeiji/agent/discord-orchestrator"
BOT_DIR="$ROOT_DIR/apps/bot"
ENV_FILE="$BOT_DIR/.runner.env"

cd "$BOT_DIR"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  source "$ENV_FILE"
  set +a
fi

exec /Users/moritaeiji/.nvm/versions/node/v25.2.1/bin/node \
  /Users/moritaeiji/agent/discord-orchestrator/apps/bot/node_modules/tsx/dist/cli.mjs \
  src/runner/index.ts
