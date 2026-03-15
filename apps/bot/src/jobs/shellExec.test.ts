import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createShellExecutor } from "./shellExec.js";
import type { JobRecord } from "./types.js";

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

describe("shellExec", () => {
  it("runs a shell command and writes logs", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "shell-exec-"));
    const logPath = path.join(tempRoot, "job.log");
    const job: JobRecord = {
      id: "job-1",
      tool: "shell",
      prompt: "printf 'hello\\n'",
      target: "local",
      status: "running",
      created_at: "2026-03-16T00:00:00.000Z",
      updated_at: "2026-03-16T00:00:00.000Z",
      discord_channel_id: "channel-1",
      log_path: logPath,
    };

    const executor = createShellExecutor(
      { workdir: tempRoot },
      noopLogger,
    );
    const result = await executor.run(job, { command: "printf 'hello\\n'" });
    const logContents = await fs.readFile(logPath, "utf8");

    expect(result.status).toBe("succeeded");
    expect(result.summary).toBe("hello");
    expect(logContents).toContain("hello");
  });
});
