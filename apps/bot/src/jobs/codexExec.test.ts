import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildCodexExecArgs,
  createCodexExecutor,
  extractAgentMessage,
  resolveWorkspaceDir,
} from "./codexExec.js";
import { createLocalRunner } from "./runner.js";
import type { JobRecord } from "./types.js";

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

describe("codexExec", () => {
  it("builds safe exec args by default", () => {
    expect(buildCodexExecArgs("hello")).toEqual(["exec", "--json", "hello"]);
    expect(
      buildCodexExecArgs("hello", { sandbox: "workspace-write" }),
    ).toEqual(["exec", "--json", "--sandbox", "workspace-write", "hello"]);
    expect(buildCodexExecArgs("hello", { fullAuto: true })).toEqual([
      "exec",
      "--json",
      "--full-auto",
      "hello",
    ]);
  });

  it("extracts the last agent message from full and delta events", () => {
    const state = { activeItemId: null, content: "" };

    expect(
      extractAgentMessage(
        { type: "agent_message", item_id: "m1", message: "Planning" },
        state,
      ),
    ).toBe("Planning");

    expect(
      extractAgentMessage(
        { type: "agent_message_delta", item_id: "m1", delta: " now" },
        state,
      ),
    ).toBe("Planning now");

    expect(
      extractAgentMessage(
        { type: "task_complete", last_agent_message: "Finished" },
        state,
      ),
    ).toBe("Finished");
  });

  it("clones a workspace, runs codex exec, and persists jsonl output", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-exec-"));
    const sourceRepo = path.join(tempRoot, "repo");
    const workspaceRoot = path.join(tempRoot, "workspaces");
    const logPath = path.join(tempRoot, "logs", "job-test.jsonl");
    const fakeCodex = path.join(tempRoot, "fake-codex.sh");
    const runner = createLocalRunner();

    await fs.mkdir(sourceRepo, { recursive: true });
    await runner.run("git", ["init", "--quiet", sourceRepo]);
    await fs.writeFile(
      fakeCodex,
      [
        "#!/bin/sh",
        "printf '%s\\n' '{\"type\":\"agent_message\",\"item_id\":\"m1\",\"message\":\"Planning\"}'",
        "printf '%s\\n' '{\"type\":\"agent_message_delta\",\"item_id\":\"m1\",\"delta\":\" execution\"}'",
        "printf '%s\\n' '{\"type\":\"task_complete\",\"last_agent_message\":\"Done\"}'",
      ].join("\n"),
      "utf8",
    );
    await fs.chmod(fakeCodex, 0o755);

    const executor = createCodexExecutor(
      {
        codexBin: fakeCodex,
        workspaceRoot,
        sourceRepo,
      },
      noopLogger,
      runner,
    );

    const job: JobRecord = {
      id: "test",
      tool: "codex",
      prompt: "run something",
      target: "local",
      status: "running",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      discord_channel_id: "channel-1",
      log_path: logPath,
    };

    let observedPid = 0;
    const result = await executor.run(job, {
      onPid: (pid) => {
        observedPid = pid;
      },
    });

    const workspaceDir = resolveWorkspaceDir(workspaceRoot, job.id);
    const logged = await fs.readFile(logPath, "utf8");
    const lines = logged.trim().split("\n");

    expect(observedPid).toBeGreaterThan(0);
    expect(result.status).toBe("succeeded");
    expect(result.summary).toBe("Done");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("\"type\":\"agent_message\"");
    expect(lines[2]).toContain("\"last_agent_message\":\"Done\"");
    expect(
      await fs.stat(path.join(workspaceDir, ".git")).then(() => true),
    ).toBe(true);
  });
});
