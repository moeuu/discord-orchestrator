# discord-codex-orchestrator

Discord を入口にして Codex CLI と Kaggle Autopilot のジョブ管理を行う bot です。現在の前提は `Railway 上の bot/control plane` と `各マシン上の long-polling runner` の分離構成です。

この repo は 1 つですが、`BOT_RUNNER_ID` と Discord token を変えれば `macbook` / `home` / `lab` 用の bot を同じコードで増やせます。

## 構成

- Railway: Discord bot、job queue、dashboard API
- ローカルマシン: `npm run runner` で Codex 実行
- Discord:
  - `/codex run prompt:...`
  - `@codex-bot ...`

この bot は単一 runner 専用です。`macbook:` のような target 指定は不要で、bot に送った Codex job はその bot に紐づく runner にだけ流れます。

## Bot セットアップ

```sh
cd apps/bot
npm install
npm run register
npm run dev
```

`apps/bot/.env` には少なくとも以下を入れます。

```env
DISCORD_TOKEN=...
DISCORD_APP_ID=...
DISCORD_GUILD_ID=...
BOT_RUNNER_ID=macbook
BOT_RUNNER_LABEL=MacBook
RUNNER_API_TOKEN=...
RUNNER_LONG_POLL_TIMEOUT_MS=25000
WORKSPACE_SOURCE_REPO=git@github.com:owner/repo.git
CHAT_COMMANDS_ENABLED=true
CHAT_COMMANDS_REQUIRE_MENTION=true
CHAT_COMMANDS_ALLOWED_USER_IDS=
CHAT_LLM_ENABLED=false
LOG_STREAM_USE_THREADS=false
DASHBOARD_HOST=0.0.0.0
DASHBOARD_PORT=
DASHBOARD_BASE_URL=
RAILWAY_PUBLIC_DOMAIN=
```

`WORKSPACE_SOURCE_REPO` は clone 可能な canonical Git URL を使います。runner は毎回そこから workspace を作ります。

## Runner セットアップ

MacBook など実行マシン側では `apps/bot/.runner.env` を作り、`npm run runner` を起動します。runner は bot 用 `.env` を読まず、`.runner.env` だけを読みます。

```env
RUNNER_ID=macbook
RUNNER_API_BASE_URL=https://discord-orchestrator-production.up.railway.app
RUNNER_API_TOKEN=...
RUNNER_HEARTBEAT_INTERVAL_MS=3000
RUNNER_RETRY_DELAY_MS=3000
CODEX_BIN=codex
WORKSPACE_ROOT=/Users/you/.discord-orchestrator/workspaces
WORKSPACE_SOURCE_REPO=git@github.com:owner/repo.git
CODEX_FULL_AUTO=false
CODEX_SANDBOX=
LOG_LEVEL=info
```

`CODEX_BIN=codex` のままで構いません。runner は自身を起動している Node の directory を child process の `PATH` 先頭に足してから `codex` を解決するので、`launchd` や `systemd` の薄い環境でも `#!/usr/bin/env node` な CLI を起動できます。

起動確認:

```sh
cd apps/bot
npm run runner
```

## macOS 自動起動

この repo には以下を含めています。

- `scripts/run-macbook-runner.sh`
- `deploy/macos/com.moritaeiji.codex-runner.plist`

LaunchAgent は `RUNNER_ENV_FILE` と `RUNNER_NODE_BIN` を明示し、shell init なしで起動します。インストール後は次で自動起動できます。

```sh
mkdir -p ~/.discord-orchestrator/logs
cp deploy/macos/com.moritaeiji.codex-runner.plist ~/Library/LaunchAgents/com.moritaeiji.codex-runner.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.moritaeiji.codex-runner.plist
launchctl enable gui/$(id -u)/com.moritaeiji.codex-runner
launchctl kickstart -k gui/$(id -u)/com.moritaeiji.codex-runner
```

## Railway

Railway 側は bot service 1 つだけで動きます。`codex-bridge` は不要です。

最低限必要な env:

```env
BOT_RUNNER_ID=macbook
BOT_RUNNER_LABEL=MacBook
RUNNER_API_TOKEN=...
WORKSPACE_SOURCE_REPO=git@github.com:owner/repo.git
CHAT_COMMANDS_ENABLED=true
CHAT_COMMANDS_REQUIRE_MENTION=true
```

公開 domain があれば runner はそこへ long poll します。

## 動作確認

- `/ping` が `pong` を返す
- `/codex run prompt: pwd` で queued job が作られる
- `@codex-bot pwd` で同じ job が作られる
- runner 起動中なら job が `running -> succeeded/failed/cancelled` に進む
- `/codex cancel` で runner に cancel が伝播する

## 開発確認

```sh
cd apps/bot
npm run lint
npm test
```
