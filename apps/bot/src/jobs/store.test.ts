import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createJobStore } from "./store.js";

describe("createJobStore", () => {
  it("creates, updates, and lists persisted jobs", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "job-store-"));
    const store = createJobStore(tempDir);

    const created = await store.create({
      tool: "codex",
      prompt: "status check",
      status: "queued",
      target: "local",
      discord_channel_id: "1234567890",
      log_path: path.join(tempDir, "job.log"),
    });

    const updated = await store.update(created.id, {
      status: "running",
      pid: 4242,
      discord_message_id: "0987654321",
    });
    const loaded = await store.get(created.id);
    const jobs = await store.list();

    expect(updated.status).toBe("running");
    expect(loaded?.id).toBe(created.id);
    expect(loaded?.prompt).toBe("status check");
    expect(loaded?.discord_channel_id).toBe("1234567890");
    expect(loaded?.discord_message_id).toBe("0987654321");
    expect(loaded?.pid).toBe(4242);
    expect(jobs).toHaveLength(1);
  });
});
