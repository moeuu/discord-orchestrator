import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildCodexProgress,
  buildCodexExecArgs,
  createCodexExecutor,
  extractAgentMessage,
  renderCodexLogPreview,
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
    expect(
      buildCodexExecArgs("hello again", { threadId: "thread-123" }),
    ).toEqual(["exec", "resume", "thread-123", "--json", "hello again"]);
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

    expect(
      extractAgentMessage(
        {
          type: "item.completed",
          item: {
            id: "item_9",
            type: "agent_message",
            text: "Final answer",
          },
        },
        state,
      ),
    ).toBe("Final answer");
  });

  it("builds live codex progress from command and agent events", () => {
    const started = buildCodexProgress(
      undefined,
      {
        type: "item.started",
        item: {
          id: "item_1",
          type: "command_execution",
          command: "/bin/zsh -lc 'git status --short --branch'",
        },
      },
      null,
    );
    const completed = buildCodexProgress(
      started,
      {
        type: "item.completed",
        item: {
          id: "item_1",
          type: "command_execution",
          command: "/bin/zsh -lc 'git status --short --branch'",
          exit_code: 0,
        },
      },
      null,
    );
    const answered = buildCodexProgress(
      completed,
      {
        type: "item.completed",
        item: {
          id: "item_2",
          type: "agent_message",
          text: "現在のブランチと差分を確認しました。",
        },
      },
      "現在のブランチと差分を確認しました。",
    );

    expect(started.phase).toBe("コマンド実行中");
    expect(started.activity).toContain("git status --short --branch");
    expect(started.recent_logs?.at(-1)).toBe(
      "実行開始: git status --short --branch",
    );
    expect(completed.active_command).toBeUndefined();
    expect(completed.recent_logs?.at(-1)).toBe(
      "実行完了(0): git status --short --branch",
    );
    expect(answered.latest_agent_message).toBe(
      "現在のブランチと差分を確認しました。",
    );
    expect(answered.recent_logs?.at(-1)).toContain("考え:");
  });

  it("renders codex jsonl as a readable preview", () => {
    const preview = renderCodexLogPreview([
      "{\"type\":\"thread.started\",\"thread_id\":\"thread-1\"}",
      "{\"type\":\"turn.started\"}",
      "{\"type\":\"item.started\",\"item\":{\"id\":\"item_1\",\"type\":\"command_execution\",\"command\":\"/bin/zsh -lc 'git status --short --branch'\"}}",
      "{\"type\":\"item.completed\",\"item\":{\"id\":\"item_1\",\"type\":\"command_execution\",\"command\":\"/bin/zsh -lc 'git status --short --branch'\",\"exit_code\":0}}",
      "{\"type\":\"item.completed\",\"item\":{\"id\":\"item_2\",\"type\":\"agent_message\",\"text\":\"確認しました。\"}}",
    ].join("\n"));

    expect(preview).toContain("セッションを開始");
    expect(preview).toContain("実行開始: git status --short --branch");
    expect(preview).toContain("考え: 確認しました。");
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
    await runner.run("git", ["-C", sourceRepo, "remote", "add", "origin", "https://github.com/moeuu/discord-orchestrator.git"]);
    await fs.writeFile(
      fakeCodex,
      [
        "#!/bin/sh",
        "printf '%s\\n' '{\"type\":\"item.completed\",\"item\":{\"id\":\"item_0\",\"type\":\"agent_message\",\"text\":\"Planning\"}}'",
        "printf '%s\\n' '{\"type\":\"agent_message_delta\",\"item_id\":\"item_0\",\"delta\":\" execution\"}'",
        "printf '%s\\n' '{\"type\":\"item.completed\",\"item\":{\"id\":\"item_1\",\"type\":\"agent_message\",\"text\":\"Done\"}}'",
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
    const workspaceOrigin = await runner.run(
      "git",
      ["-C", workspaceDir, "remote", "get-url", "origin"],
    );

    expect(observedPid).toBeGreaterThan(0);
    expect(result.status).toBe("succeeded");
    expect(result.summary).toBe("Done");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("\"type\":\"item.completed\"");
    expect(lines[2]).toContain("\"text\":\"Done\"");
    expect(workspaceOrigin.stdout.trim()).toBe(
      "git@github.com:moeuu/discord-orchestrator.git",
    );
    expect(
      await fs.stat(path.join(workspaceDir, ".git")).then(() => true),
    ).toBe(true);
  });
});
