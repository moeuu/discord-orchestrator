import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createJobStore } from "./store.js";

describe("createJobStore", () => {
  it("creates and retrieves the latest job", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "job-store-"));
    const store = createJobStore(tempDir);

    const created = await store.create({
      prompt: "status check",
      status: "queued",
      target: "local",
      logPath: path.join(tempDir, "job.log"),
    });

    const latest = await store.getLatest();
    const loaded = await store.getByJobId(created.jobId);

    expect(latest?.jobId).toBe(created.jobId);
    expect(loaded?.prompt).toBe("status check");
  });
});
