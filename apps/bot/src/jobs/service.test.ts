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
    });

    const job = await service.createJob({
      prompt: "dummy prompt",
      target: "local",
      discordChannelId: "channel-1",
    });
    const logInfo = await service.getLogInfo(job.id);

    expect(job.discord_channel_id).toBe("channel-1");
    expect(job.log_path).toContain(path.join("logs", `job-${job.id}.jsonl`));
    expect(logInfo.preview).toBeNull();
  });
});
