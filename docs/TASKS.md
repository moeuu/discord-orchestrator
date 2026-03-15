# TASKS

## Stage 1

- [x] リポジトリ構成を作る
- [x] `docs/architecture.md` を作る
- [x] `docs/discord-setup.md` を作る
- [x] `README.md` に起動手順とセットアップ概要を書く
- [x] `.env.example` と `.gitignore` を整える

## Stage 2

- [x] `/ping` を実装
- [x] `/codex status` を実装
- [x] `JobStore` 抽象と JSON 実装を用意
- [x] Job status 用 Embed を作る
- [x] lint/test/dev スクリプトを整える

## Stage 3

- [x] `/codex run` ダミー実装
- [x] ジョブ作成時に `discord_message_id` を保存
- [x] 同一メッセージ更新で進捗を見せる
- [x] ログファイルパスを保存する

## Stage 4

- [x] `/codex logs` を実装
- [x] `/codex cancel` を実装
- [x] `codex exec --json` 実行へ置き換える
- [ ] `ssh` runner を実装
