import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createBridgeCodexExecutor } from "./bridgeCodexExec.js";
import type { JobRecord } from "./types.js";

const noopLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

describe("bridgeCodexExec", () => {
  const servers: http.Server[] = [];

  afterEach(async () => {
    await Promise.all(
      servers.map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
    servers.length = 0;
  });

  it("streams remote codex events from the bridge and persists logs", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "bridge-codex-"));
    const logPath = path.join(tempRoot, "logs", "job.jsonl");
    const observedHeaders: string[] = [];

    const server = http.createServer((request, response) => {
      observedHeaders.push(request.headers.authorization ?? "");
      response.writeHead(200, {
        "content-type": "application/x-ndjson; charset=utf-8",
      });
      response.write(JSON.stringify({ type: "bridge.started", pid: 123 }) + "\n");
      response.write(
        JSON.stringify({
          type: "thread.started",
          thread_id: "thread-123",
        }) + "\n",
      );
      response.write(
        JSON.stringify({
          type: "item.completed",
          item: {
            id: "item_1",
            type: "agent_message",
            text: "Planning",
          },
        }) + "\n",
      );
      response.end(
        JSON.stringify({
          type: "bridge.finished",
          status: "succeeded",
          summary: "Planning",
        }) + "\n",
      );
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    servers.push(server);
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const executor = createBridgeCodexExecutor(
      {
        codexBin: "codex",
        workspaceRoot: path.join(tempRoot, "workspaces"),
        sourceRepo: "git@github.com:moeuu/discord-orchestrator.git",
        bridgeAuthToken: "secret-token",
        targets: [
          {
            id: "macbook",
            displayName: "MacBook",
            transport: "bridge",
            bridgeBaseUrl: `http://127.0.0.1:${port}`,
            sshHost: "macbook.tail",
            sshUser: "moritaeiji",
            workspaceRoot: "/Users/moritaeiji/.discord-orchestrator/workspaces",
            codexBin: "codex",
            aliases: ["macbook"],
          },
        ],
      },
      noopLogger,
    );

    const job: JobRecord = {
      id: "job-1",
      tool: "codex",
      prompt: "inspect the repo",
      target: "ssh",
      runner_id: "macbook",
      status: "running",
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      discord_channel_id: "channel-1",
      log_path: logPath,
    };

    let observedPid = 0;
    let observedThreadId = "";
    const result = await executor.run(job, {
      onPid(pid) {
        observedPid = pid;
      },
      onEvent(event) {
        if (typeof event.thread_id === "string") {
          observedThreadId = event.thread_id;
        }
      },
    });

    const logged = await fs.readFile(logPath, "utf8");

    expect(observedPid).toBe(123);
    expect(observedThreadId).toBe("thread-123");
    expect(result.status).toBe("succeeded");
    expect(result.summary).toBe("Planning");
    expect(logged).toContain("\"thread_id\":\"thread-123\"");
    expect(observedHeaders).toEqual(["Bearer secret-token"]);
  });
});
