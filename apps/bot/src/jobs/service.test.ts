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

  it("stores runner_id for queued runner codex jobs", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "job-service-"));
    const dataDir = path.join(tempRoot, "data");
    const logDir = path.join(tempRoot, "logs");
    const store = createJobStore(dataDir);
    const service = createJobService(store, logDir, noopLogger, {
      codexBin: "codex",
      workspaceRoot: path.join(tempRoot, "workspaces"),
      sourceRepo: "git@github.com:moeuu/discord-orchestrator.git",
    }, {
      autopilotBin: "uv",
      workdir: tempRoot,
    }, {
      workdir: tempRoot,
    });

    const job = await service.createJob({
      prompt: "follow up",
      target: "runner",
      runnerId: "macbook",
      discordChannelId: "channel-1",
    });

    expect(job.target).toBe("runner");
    expect(job.runner_id).toBe("macbook");
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

  it("claims, updates, and finishes a runner codex job", async () => {
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

    const queued = await service.createJob({
      prompt: "inspect the repo",
      target: "runner",
      runnerId: "macbook",
      discordChannelId: "channel-1",
    });

    const claimed = await service.claimNextRunnerJob("macbook");
    expect(claimed?.id).toBe(queued.id);
    expect(claimed?.status).toBe("running");

    const started = await service.markRunnerJobStarted(queued.id, 4242);
    expect(started?.pid).toBe(4242);

    const heartbeat = await service.appendRunnerCodexEvent(
      queued.id,
      { type: "thread.started", thread_id: "thread-1" },
      "started",
    );
    expect(heartbeat.job?.external_id).toBe("thread-1");
    expect(heartbeat.cancelRequested).toBe(false);

    const finished = await service.finishRunnerJob(queued.id, {
      status: "succeeded",
      summary: "done",
      finished_at: "2026-03-15T00:10:00.000Z",
    });

    expect(finished?.status).toBe("succeeded");
    expect(finished?.summary).toBe("done");
    expect(finished?.finished_at).toBe("2026-03-15T00:10:00.000Z");
  });
});
