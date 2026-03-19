# discord-codex-orchestrator

Discord Slash Command を入口にして、Codex CLI と Kaggle Autopilot のジョブ実行、進捗更新、ダッシュボード表示を扱う Discord Bot リポジトリです。基本はローカルの `codex` CLI と `uv run kagglebot autopilot ...` を使い、必要なら Discord の `@mention` もローカルの `codex exec` に渡して `reply / shell / codex` を振り分けられます。

## ディレクトリ構成

```text
discord-codex-orchestrator/
  docs/
  apps/bot/
  config/
  scripts/
  data/   # 実行時生成。コミットしない
  logs/   # 実行時生成。コミットしない
```

## ローカル起動

1. `apps/bot/.env.example` を参考に `apps/bot/.env` を作成
2. Discord Bot Token、Application ID、Guild ID を設定
3. `cd apps/bot && npm install`
4. `npm run register` でスラッシュコマンドをギルドへ登録
5. `npm run dev` で bot を起動

普段の起動と再起動は repo ルートから `./scripts/botctl.sh` を使う方が楽です。

```sh
./scripts/botctl.sh start
./scripts/botctl.sh restart
./scripts/botctl.sh status
./scripts/botctl.sh logs
./scripts/botctl.sh reload
```

- `start`: bot をバックグラウンド起動
- `restart`: bot を再起動
- `status`: 起動中か確認
- `logs`: `logs/bot-runtime.log` を tail
- `reload`: slash command を再登録してから再起動

PID は `data/runtime/bot.pid`、実行ログは `logs/bot-runtime.log` に保存します。

最低限の確認は以下です。

```sh
cd apps/bot
npm run lint
npm test
npm run dev
```

`.env` には少なくとも以下を設定します。

```env
DISCORD_TOKEN=...
DISCORD_APP_ID=...
DISCORD_GUILD_ID=...
TARGETS_CONFIG_PATH=../../config/targets.yaml
CODEX_DEFAULT_TARGET=macbook
RUNNER_BRIDGE_AUTH_TOKEN=...
STORAGE_ROOT=
WORKSPACE_ROOT=
WORKSPACE_SOURCE_REPO=git@github.com:owner/repo.git
CHAT_COMMANDS_ENABLED=false
CHAT_COMMANDS_REQUIRE_MENTION=true
CHAT_COMMANDS_ALLOWED_USER_IDS=
CHAT_COMMANDS_WORKDIR=
CHAT_LLM_ENABLED=false
CHAT_LLM_MODEL=gpt-5.4
LOG_STREAM_USE_THREADS=false
DASHBOARD_HOST=0.0.0.0
DASHBOARD_PORT=
DASHBOARD_BASE_URL=
RAILWAY_PUBLIC_DOMAIN=
BRIDGE_BIND_HOST=0.0.0.0
BRIDGE_PORT=
AUTOPILOT_WORKDIR=
AUTOPILOT_ARTIFACTS_DIR=
AUTOPILOT_REMOTE_WATCH_ENABLED=true
AUTOPILOT_REMOTE_WATCH_HOST=lab_rdp
AUTOPILOT_REMOTE_WATCH_RUNNER_ID=lab_rdp
AUTOPILOT_REMOTE_WATCH_CHANNEL_ID=<discord channel id>
```

複数マシンへ Codex を投げるときは `WORKSPACE_SOURCE_REPO` に clone 可能な Git URL を入れてください。remote runner はこの URL を使って各実行先に `git clone` します。ローカルだけで動かす場合は省略可能で、bot を起動している checkout 自体を clone 元として使います。`CHAT_COMMANDS_WORKDIR` も未指定なら現在の checkout を使います。

永続化先は `STORAGE_ROOT` を 1 つ設定すればまとまります。たとえば Railway volume を `/data` に mount して `STORAGE_ROOT=/data` を入れると、workspace は `/data/workspaces`、job store は `/data/data`、ログは `/data/logs` に出ます。既存の `WORKSPACE_ROOT` `JOB_DATA_DIR` `LOG_DIR` を個別に指定したい場合はそのまま使えます。

`CODEX_FULL_AUTO=false` と `CODEX_SANDBOX=` がデフォルトで、必要なときだけ `--full-auto` または `--sandbox` を環境変数経由で有効化できます。

Discord から Codex を remote 実行したい場合は `config/targets.yaml` を用意し、`macbook` のような論理 target を定義します。例は [config/targets.example.yaml](config/targets.example.yaml) を参照してください。

bot は `/codex run target:macbook prompt:...` と `@codex-bot macbook: ...` の両方で target を選べます。`CODEX_DEFAULT_TARGET` を設定しておけば、`@mention` で target を省略した場合もその runner に送ります。

Discord チャットから shell コマンドを直接起動したい場合は `CHAT_COMMANDS_ENABLED=true` を設定してください。デフォルトでは bot mention 必須で、メッセージ中の fenced code block / backtick / `「...」っていうコマンドを実行して` からコマンド文字列を抽出して実行します。安全のため `CHAT_COMMANDS_ALLOWED_USER_IDS=123,456` のように allowlist も併用してください。

この機能を使うときは Discord Developer Portal の Bot 設定で `Message Content Intent` も有効化してください。未設定のまま `CHAT_COMMANDS_ENABLED=true` で起動すると、bot は `Used disallowed intents` で接続できません。

`@codex-bot` の通常メッセージを LLM に渡したい場合は `CHAT_LLM_ENABLED=true` を設定してください。bot は `codex exec` にメッセージを送り、`reply / shell / codex` のいずれかを JSON で返させて処理します。現行のデフォルト model は `gpt-5.4` です。

この `@mention` 会話は channel ごとに Codex session を継続します。`action=codex` に分岐した実作業も同じ session を引き継ぐので、直後の follow-up では前の作業内容を前提に質問できます。明示的に `新しいセッション`、`セッションをリセット`、`会話をリセット` のように書いたときだけ、新しい session でやり直します。

ログを毎回 thread に分けたくない場合は `LOG_STREAM_USE_THREADS=false` のまま使ってください。これが既定です。`true` にするとログ専用 thread を作ります。

Autopilot の進捗ダッシュボードは `DASHBOARD_HOST` `DASHBOARD_PORT` `DASHBOARD_BASE_URL` で設定します。`DASHBOARD_PORT` 未指定時は `PORT` を優先し、さらに未指定なら `8787` を使います。`DASHBOARD_BASE_URL` 未指定時は、Railway では `RAILWAY_PUBLIC_DOMAIN` から `https://...` を自動組み立て、それ以外では `http://127.0.0.1:<port>` を使います。

Railway に載せる場合は、bot service とは別に `npm run start:bridge` を使う bridge service を 1 つ追加し、bridge service 側でも同じ `TARGETS_CONFIG_PATH` と `RUNNER_BRIDGE_AUTH_TOKEN` を設定してください。公開 dashboard が必要なら service domain を有効化し、必要なら `DASHBOARD_BASE_URL` を明示してください。HTTP server 自体は `0.0.0.0:$PORT` で待ち受けるようにしてあります。

MacBook 側は Tailscale 参加済み、`codex` ログイン済み、`git clone` できる状態を前提にします。bridge service は Tailscale 上の `sshHost` / `sshUser` へ SSH して `codex exec --json` を起動します。

研究室 Ubuntu で手動に `uv run kagglebot autopilot ...` を打った run も Discord に流したい場合は、bot 側で `AUTOPILOT_REMOTE_WATCH_*` を設定し、研究室マシンの shell で `source /path/to/discord-orchestrator/scripts/autopilot-shell-hook.sh` を読み込んでください。以後は同じ `uv run kagglebot autopilot ...` を打つだけで `~/.discord-orchestrator/autopilot-sessions/` に session manifest と console log が残り、bot が `ssh lab_rdp` 経由で自動検出して Discord embed とログ thread を作成します。

## 動作確認

```sh
cd apps/bot
npm run register
npm run dev
```

bot 起動後、開発用 Guild で以下を確認します。

- `/ping` が `pong` を返す
- `/codex status` がジョブ未作成時メッセージまたは最新ジョブを返す
- `/codex run target:macbook` が bridge service 経由で MacBook 上の `codex exec --json` を実行する
- `@codex-bot macbook: README を直して` が同じ codex job 経路に入る
- `/autopilot run` が `AUTOPILOT_WORKDIR` で `uv run kagglebot autopilot ...` を実行し、Discord embed とダッシュボードを自動更新する
- 研究室 Ubuntu の manual run は shell hook + `AUTOPILOT_REMOTE_WATCH_ENABLED=true` で自動検出し、Discord に同じ UI で流す

## Discord セットアップ概要

1. Discord Developer Portal でアプリケーションを作成
2. Bot を追加して Token を生成
3. OAuth2 URL Generator で `bot` と `applications.commands` を付けてサーバーへ招待
4. 開発用 Guild にコマンド登録するため Guild ID を控える

詳細は [docs/discord-setup.md](docs/discord-setup.md) を参照してください。

## ポリシー

- `data/` `logs/` `.env` `config/targets.yaml` はコミットしない
- `~/.codex/` も Git 管理しない
- Discord トークンやセッション情報は共有しない

## MVP

- `/ping`
- `/codex status`
- `/codex run` は local または remote runner で `codex exec --json` を実行
- `/autopilot run` は artifacts から iter/strategy を抽出して進捗更新
- 進捗は同一メッセージを編集して更新

詳細は [docs/architecture.md](docs/architecture.md) と [docs/TASKS.md](docs/TASKS.md) を参照してください。
