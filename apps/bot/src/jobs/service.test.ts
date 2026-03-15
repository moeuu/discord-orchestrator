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
  it("creates a job with a persisted log path", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "job-service-"));
    const dataDir = path.join(tempRoot, "data");
    const logDir = path.join(tempRoot, "logs");
    const store = createJobStore(dataDir);
    const service = createJobService(store, logDir, noopLogger);

    const job = await service.createJob({
      prompt: "dummy prompt",
      target: "local",
    });
    const logInfo = await service.getLogInfo(job.jobId);

    expect(job.logPath).toContain(path.join("logs", "jobs"));
    expect(logInfo.preview).toContain("job created");
  });
});
