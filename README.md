# discord-codex-orchestrator

Discord Slash Command を入口にして、Codex CLI と Kaggle Autopilot のジョブ実行、進捗更新、ダッシュボード表示を扱う Discord Bot リポジトリです。OpenAI API は使わず、ローカルで ChatGPT ログイン済みの `codex` CLI と `uv run kagglebot autopilot ...` を使う前提で組みます。

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
WORKSPACE_ROOT=../../data/workspaces
WORKSPACE_SOURCE_REPO=/absolute/path/to/source/repo
AUTOPILOT_WORKDIR=/absolute/path/to/kaggle-autopilot
AUTOPILOT_ARTIFACTS_DIR=/absolute/path/to/kaggle-autopilot/artifacts
```

`WORKSPACE_SOURCE_REPO` を省略した場合は、bot 起動時の Git リポジトリルートを clone 元として使います。`CODEX_FULL_AUTO=false` と `CODEX_SANDBOX=` がデフォルトで、必要なときだけ `--full-auto` または `--sandbox` を環境変数経由で有効化できます。

Autopilot の進捗ダッシュボードは `DASHBOARD_PORT` と `DASHBOARD_BASE_URL` で設定します。デフォルトでは `http://127.0.0.1:8787` に立ち上がり、`/jobs/<job-id>` で iter ごとの戦略、metrics、ログ末尾を確認できます。

## 動作確認

```sh
cd apps/bot
npm run register
npm run dev
```

bot 起動後、開発用 Guild で以下を確認します。

- `/ping` が `pong` を返す
- `/codex status` がジョブ未作成時メッセージまたは最新ジョブを返す
- `/codex run` が `data/workspaces/job-<id>/` に clone した作業ツリー上で `codex exec --json` を実行する
- `/autopilot run` が `AUTOPILOT_WORKDIR` で `uv run kagglebot autopilot ...` を実行し、Discord embed とダッシュボードを自動更新する

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
- `/codex run` は local runner で `codex exec --json` を実行
- `/autopilot run` は artifacts から iter/strategy を抽出して進捗更新
- 進捗は同一メッセージを編集して更新

詳細は [docs/architecture.md](docs/architecture.md) と [docs/TASKS.md](docs/TASKS.md) を参照してください。
