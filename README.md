# discord-codex-orchestrator

Discord Slash Command を入口にして、Codex CLI のジョブ実行と進捗更新を扱う Discord Bot リポジトリです。OpenAI API は使わず、ローカルで ChatGPT ログイン済みの `codex` CLI を使う前提で組みます。

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
- `/codex run` はダミー実装から開始
- 進捗は同一メッセージを編集して更新

詳細は [docs/architecture.md](docs/architecture.md) と [docs/TASKS.md](docs/TASKS.md) を参照してください。
