# Architecture

## Goal

Discord bot は Railway 上で常時稼働させ、Codex 実行は各マシン上の runner に委譲する。

## Core Idea

- bot ごとに 1 つの `BOT_RUNNER_ID` を持つ
- Discord から来た Codex job はその runner 向けに queue される
- 実行マシン上の runner が bot の HTTP API を long poll して job を claim する
- runner は local で `codex exec --json` を実行し、event を bot に返す
- bot は job store と Discord embed を更新する

## Components

- `apps/bot/src/index.ts`
  Railway 上の bot entrypoint
- `apps/bot/src/dashboard.ts`
  dashboard API と runner API を同居させた HTTP server
- `apps/bot/src/discord`
  slash command、mention 処理、Discord embed 更新
- `apps/bot/src/jobs`
  JobStore、Codex 実行、Autopilot 実行
- `apps/bot/src/runner`
  long-polling runner

## Runner Flow

1. runner が `/api/runner/poll` を long poll
2. bot が queued job を返し、`running` に更新
3. runner が local workspace を作って `codex exec --json` を実行
4. runner が event を `/api/runner/jobs/:id/event` に送る
5. bot が progress と Discord message を更新する
6. cancel 時は bot が `cancel_requested_at` を立て、runner heartbeat が abort する
7. runner が `/finish` を送り、最終 status を閉じる

## Why This Shape

- Railway から各マシンへ SSH/Tailscale で inbound 接続しなくてよい
- MacBook / 家 / 研究室で同じ runner 実装を再利用できる
- bot ごとに Discord token と `BOT_RUNNER_ID` を変えるだけで分離できる
