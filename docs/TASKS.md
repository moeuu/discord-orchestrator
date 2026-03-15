# TASKS

## Stage 1

- [x] リポジトリ構成を作る
- [x] `docs/architecture.md` を作る
- [x] `docs/discord-setup.md` を作る
- [x] `README.md` に起動手順とセットアップ概要を書く
- [x] `.env.example` と `.gitignore` を整える

## Stage 2

- [ ] `/ping` を実装
- [ ] `/codex status` を実装
- [ ] `JobStore` 抽象と JSON 実装を用意
- [ ] Job status 用 Embed を作る
- [ ] lint/test/dev スクリプトを整える

## Stage 3

- [ ] `/codex run` ダミー実装
- [ ] ジョブ作成時に `discord_message_id` を保存
- [ ] 同一メッセージ更新で進捗を見せる
- [ ] ログファイルパスを保存する

## Stage 4

- [ ] `/codex logs` を実装
- [ ] `/codex cancel` を実装
- [ ] `codex exec --jsonl` 実行へ置き換える
- [ ] `ssh` runner を実装
