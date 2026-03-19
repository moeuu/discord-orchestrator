import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createJobService } from "./service.js";
import { createJobStore } from "./store.js";

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

describe("createJobService", () => {
  it("creates a job with a persisted jsonl log path", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "job-service-"));
    const dataDir = path.join(tempRoot, "data");
    const logDir = path.join(tempRoot, "logs");
    const store = createJobStore(dataDir);
    const service = createJobService(store, logDir, noopLogger, {
      codexBin: "codex",
      workspaceRoot: path.join(tempRoot, "workspaces"),
      sourceRepo: tempRoot,
    }, {
      autopilotBin: "uv",
      workdir: tempRoot,
    }, {
      workdir: tempRoot,
    });

    const job = await service.createJob({
      prompt: "dummy prompt",
      target: "local",
      discordChannelId: "channel-1",
    });
    const logInfo = await service.getLogInfo(job.id);

    expect(job.discord_channel_id).toBe("channel-1");
    expect(job.tool).toBe("codex");
    expect(job.log_path).toContain(path.join("logs", `codex-${job.id}.jsonl`));
    expect(logInfo.preview).toBeNull();
  });

  it("persists an existing codex session id on created jobs", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "job-service-"));
    const dataDir = path.join(tempRoot, "data");
    const logDir = path.join(tempRoot, "logs");
    const store = createJobStore(dataDir);
    const service = createJobService(store, logDir, noopLogger, {
      codexBin: "codex",
      workspaceRoot: path.join(tempRoot, "workspaces"),
      sourceRepo: tempRoot,
    }, {
      autopilotBin: "uv",
      workdir: tempRoot,
    }, {
      workdir: tempRoot,
    });

    const job = await service.createJob({
      prompt: "follow up",
      target: "local",
      discordChannelId: "channel-1",
      externalId: "thread-123",
    });

    expect(job.external_id).toBe("thread-123");
  });

  it("formats codex jsonl logs into a readable preview", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "job-service-"));
    const dataDir = path.join(tempRoot, "data");
    const logDir = path.join(tempRoot, "logs");
    const store = createJobStore(dataDir);
    const service = createJobService(store, logDir, noopLogger, {
      codexBin: "codex",
      workspaceRoot: path.join(tempRoot, "workspaces"),
      sourceRepo: tempRoot,
    }, {
      autopilotBin: "uv",
      workdir: tempRoot,
    }, {
      workdir: tempRoot,
    });

    const job = await service.createJob({
      prompt: "inspect the repo",
      target: "local",
      discordChannelId: "channel-1",
    });

    await fs.writeFile(
      job.log_path!,
      [
        "{\"type\":\"thread.started\",\"thread_id\":\"thread-1\"}",
        "{\"type\":\"turn.started\"}",
        "{\"type\":\"item.started\",\"item\":{\"id\":\"item_1\",\"type\":\"command_execution\",\"command\":\"/bin/zsh -lc 'git status --short --branch'\"}}",
        "{\"type\":\"item.completed\",\"item\":{\"id\":\"item_1\",\"type\":\"command_execution\",\"command\":\"/bin/zsh -lc 'git status --short --branch'\",\"exit_code\":0}}",
        "{\"type\":\"item.completed\",\"item\":{\"id\":\"item_2\",\"type\":\"agent_message\",\"text\":\"確認しました。\"}}",
      ].join("\n"),
      "utf8",
    );

    const logInfo = await service.getLogInfo(job.id);

    expect(logInfo.preview).toContain("セッションを開始");
    expect(logInfo.preview).toContain("実行完了(0): git status --short --branch");
    expect(logInfo.preview).toContain("考え: 確認しました。");
  });

  it("upserts a remote manual autopilot session by external id", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "job-service-"));
    const dataDir = path.join(tempRoot, "data");
    const logDir = path.join(tempRoot, "logs");
    const store = createJobStore(dataDir);
    const service = createJobService(store, logDir, noopLogger, {
      codexBin: "codex",
      workspaceRoot: path.join(tempRoot, "workspaces"),
      sourceRepo: tempRoot,
    }, {
      autopilotBin: "uv",
      workdir: tempRoot,
    }, {
      workdir: tempRoot,
    });

    const first = await service.observeRemoteAutopilotSession({
      sessionId: "session-1",
      competition: "house-prices",
      instruction: "try a tree baseline",
      command: "uv run kagglebot autopilot house-prices --goal 'try a tree baseline'",
      runnerId: "lab_rdp",
      discordChannelId: "channel-1",
      dashboardBaseUrl: "http://127.0.0.1:8787",
      remoteLogPath: "/home/ubuntu/.discord-orchestrator/autopilot-sessions/session-1/console.log",
      artifactRoot: "/home/ubuntu/kaggle-autopilot/artifacts/house-prices",
      status: "running",
      startedAt: "2026-03-15T00:00:00.000Z",
      progress: {
        phase: "iterating",
        current_iter: 2,
      },
    });

    const second = await service.observeRemoteAutopilotSession({
      sessionId: "session-1",
      competition: "house-prices",
      instruction: "try a tree baseline",
      command: "uv run kagglebot autopilot house-prices --goal 'try a tree baseline'",
      runnerId: "lab_rdp",
      discordChannelId: "channel-1",
      dashboardBaseUrl: "http://127.0.0.1:8787",
      remoteLogPath: "/home/ubuntu/.discord-orchestrator/autopilot-sessions/session-1/console.log",
      artifactRoot: "/home/ubuntu/kaggle-autopilot/artifacts/house-prices",
      status: "succeeded",
      startedAt: "2026-03-15T00:00:00.000Z",
      finishedAt: "2026-03-15T00:10:00.000Z",
      progress: {
        phase: "completed",
        current_iter: 5,
      },
    });

    expect(first.created).toBe(true);
    expect(first.job.external_id).toBe("session-1");
    expect(first.job.remote_log_path).toContain("console.log");
    expect(first.job.log_path).toContain(path.join("logs", `autopilot-${first.job.id}.log`));
    expect(second.created).toBe(false);
    expect(second.job.id).toBe(first.job.id);
    expect(second.job.status).toBe("succeeded");
    expect(second.job.finished_at).toBe("2026-03-15T00:10:00.000Z");
    expect(second.job.progress?.phase).toBe("completed");
  });
});
