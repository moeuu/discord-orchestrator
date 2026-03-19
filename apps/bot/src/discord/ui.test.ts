import { beforeEach, describe, expect, it, vi } from "vitest";

import type { JobRecord } from "../jobs/types.js";
import { buildJobEmbed, createJobMessageUpdater } from "./ui.js";

function createJob(partial: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    tool: "codex",
    prompt: "test",
    target: "local",
    status: "running",
    created_at: "2026-03-15T00:00:00.000Z",
    updated_at: "2026-03-15T00:00:00.000Z",
    discord_channel_id: "channel-1",
    discord_message_id: "message-1",
    ...partial,
  };
}

describe("createJobMessageUpdater", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T00:00:00.000Z"));
  });

  it("debounces repeated job message updates to one edit per 2 seconds", async () => {
    const edit = vi.fn().mockResolvedValue(undefined);
    const fetchMessage = vi.fn().mockResolvedValue({ edit });
    const fetchChannel = vi.fn().mockResolvedValue({
      isTextBased: () => true,
      messages: {
        fetch: fetchMessage,
      },
    });
    const client = {
      channels: {
        fetch: fetchChannel,
      },
    } as any;
    const logger = {
      debug() {},
      info() {},
      warn() {},
      error() {},
    };

    const updater = createJobMessageUpdater(client, logger);

    const first = updater.updateJobMessage(createJob());
    await vi.runAllTimersAsync();
    await first;

    const second = updater.updateJobMessage(
      createJob({ updated_at: "2026-03-15T00:00:01.000Z" }),
    );
    const third = updater.updateJobMessage(
      createJob({ updated_at: "2026-03-15T00:00:02.000Z", status: "succeeded" }),
    );

    await vi.advanceTimersByTimeAsync(1_999);
    expect(edit).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([second, third]);

    expect(fetchChannel).toHaveBeenCalledTimes(2);
    expect(fetchMessage).toHaveBeenCalledTimes(2);
    expect(edit).toHaveBeenCalledTimes(2);
  });
});

describe("buildJobEmbed", () => {
  it("builds a user-facing embed without raw log path fields", () => {
    const embed = buildJobEmbed(
      createJob({
        tool: "shell",
        status: "succeeded",
        summary: "/Users/moritaeiji/agent/discord-orchestrator",
        runner_id: "local",
        discord_thread_id: "thread-1",
        dashboard_url: "http://127.0.0.1:8787/jobs/job-1",
      }),
    ).toJSON();

    expect(embed.title).toBe("Shell 完了");
    expect(embed.description).toBe("/Users/moritaeiji/agent/discord-orchestrator");
    expect(embed.fields?.some((field) => field.name === "詳細")).toBe(true);
    expect(embed.fields?.some((field) => field.name === "log_path")).toBe(false);
    expect(embed.footer?.text).toContain("job job-1");
  });

  it("shows live codex progress in the main embed instead of raw log paths", () => {
    const embed = buildJobEmbed(
      createJob({
        tool: "codex",
        status: "running",
        summary: "実行中: git status --short --branch",
        progress: {
          phase: "コマンド実行中",
          activity: "実行中: git status --short --branch",
          latest_agent_message: "差分の確認に必要なコマンドを実行します。",
          recent_logs: [
            "セッションを開始",
            "依頼の処理を開始",
            "実行開始: git status --short --branch",
          ],
        },
      }),
    ).toJSON();

    expect(embed.fields?.some((field) => field.name === "今していること")).toBe(true);
    expect(embed.fields?.some((field) => field.name === "直近ログ")).toBe(true);
    expect(embed.fields?.some((field) => field.value?.includes("git status --short --branch"))).toBe(true);
    expect(embed.fields?.some((field) => field.name === "log_path")).toBe(false);
  });
});
