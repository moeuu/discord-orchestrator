# Architecture

## Goal

Discord の Slash Command を入口にして、Codex CLI ジョブの作成、状態確認、進捗表示、将来の SSH 実行切り替えを扱う構成です。

## Constraints

- OpenAI API は使わない
- Codex CLI は ChatGPT ログイン済み環境で使う
- Discord は Message Content Intent に依存しない
- 操作は Slash Command のみ
- secrets は `.env` のみに置く

## Components

- `apps/bot/src/discord`
  Slash Command 定義、登録、Interaction 処理、Embed 生成
- `apps/bot/src/jobs`
  Job の型、ストア、runner 抽象、Codex 実行ラッパー
- `data/jobs.json`
  開発初期のジョブ保存先。将来 SQLite に置き換える
- `logs/jobs/*.log`
  ジョブごとのログ保存先
- `config/targets.example.yaml`
  将来の `local` / `ssh` ターゲット定義テンプレート

## Job Model

最低限保存する項目は以下です。

- `id`
- `status`
- `created_at`
- `updated_at`
- `started_at`
- `finished_at`
- `target`
- `prompt`
- `discord_channel_id`
- `discord_message_id`
- `pid`
- `log_path`

初期実装では JSON ストアを使うが、読み書きは `JobStore` 抽象の内側に閉じ込めて SQLite 移行しやすくする。

## Runner Strategy

- `local` runner を先に実装する
- `ssh` runner は型と切り替え点だけ先に作る
- `/codex run` は最初ダミー実装で、後から `codex exec --jsonl` を spawn する
- `codexExec.ts` は JSONL パース責務を持たせる

## Discord UI Strategy

- ジョブごとに 1 つの進捗メッセージを持つ
- 初回応答後は同じメッセージを編集し続ける
- 表示は Embed を基本にする
- `/codex status` は単体ジョブ表示を優先し、`job_id` 未指定時は最新ジョブを返す

## Flow

1. Discord でスラッシュコマンドを実行
2. Bot が入力を検証して JobStore にジョブを作成
3. Bot が進捗 Embed を同一メッセージへ表示
4. runner がダミー実行または `codex exec` を起動
5. 状態更新ごとにストア更新とメッセージ編集を行う
6. `/codex status` `/codex logs` `/codex cancel` でジョブを操作する

## MVP Scope

### Step 1

- 設計メモ
- タスクリスト
- リポジトリ土台

### Step 2

- `/ping`
- `/codex status`
- JSON JobStore
- Embed 表示の土台

### Step 3

- `/codex run` ダミー実装
- 同一メッセージ自動更新
- ログファイル出力の土台

### Later

- `/codex logs`
- `/codex cancel`
- `codex exec --jsonl`
- SSH runner
