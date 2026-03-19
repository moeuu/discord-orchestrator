import { spawn } from "node:child_process";
import http from "node:http";
import { URL } from "node:url";

import { extractAgentMessage } from "../jobs/codexExec.js";
import type { Logger } from "../util/logger.js";
import type { CodexTarget } from "../targets.js";
import { resolveCodexTarget } from "../targets.js";

export type BridgeExecuteRequest = {
  jobId: string;
  prompt: string;
  targetId: string;
  sourceRepo: string;
  threadId?: string;
  fullAuto?: boolean;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
};

type BridgeServerConfig = {
  authToken?: string;
  targets: CodexTarget[];
};

export function startBridgeServer(
  host: string,
  port: number,
  config: BridgeServerConfig,
  logger: Logger,
): http.Server {
  const server = http.createServer(async (request, response) => {
    const url = new URL(
      request.url ?? "/",
      `http://${request.headers.host ?? "localhost"}`,
    );

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return json(response, 200, { ok: true });
      }

      if (request.method === "POST" && url.pathname === "/v1/jobs/execute") {
        if (!isAuthorized(request, config.authToken)) {
          return json(response, 401, { error: "unauthorized" });
        }

        const payload = parseExecuteRequest(await readBody(request));
        const target = resolveCodexTarget(config.targets, payload.targetId);
        if (!target || target.transport !== "bridge") {
          return json(response, 404, {
            error: `unknown bridge target: ${payload.targetId}`,
          });
        }

        if (!target.sshHost || !target.sshUser || !target.workspaceRoot) {
          return json(response, 500, {
            error: `target ${target.id} is missing sshHost/sshUser/workspaceRoot`,
          });
        }

        return await streamRemoteExecution(payload, target, response, logger);
      }

      return json(response, 404, { error: "not found" });
    } catch (error) {
      logger.error("Runner bridge request failed", error);
      if (!response.headersSent) {
        return json(response, 500, {
          error: error instanceof Error ? error.message : "internal error",
        });
      }

      response.end();
    }
  });

  server.listen(port, host, () => {
    logger.info(`Runner bridge listening on http://${host}:${port}`);
  });

  return server;
}

export function buildRemotePythonArgs(
  request: BridgeExecuteRequest,
  target: CodexTarget,
): string[] {
  return [
    "-o",
    "BatchMode=yes",
    `${target.sshUser}@${target.sshHost}`,
    "python3",
    "-c",
    REMOTE_CODEX_RUNNER_SCRIPT,
    request.sourceRepo,
    target.workspaceRoot!,
    request.jobId,
    request.prompt,
    request.threadId ?? "",
    target.codexBin ?? "codex",
    request.fullAuto ? "true" : "false",
    request.sandbox ?? "",
  ];
}

async function streamRemoteExecution(
  request: BridgeExecuteRequest,
  target: CodexTarget,
  response: http.ServerResponse,
  logger: Logger,
): Promise<void> {
  response.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
  });

  const child = spawn("ssh", buildRemotePythonArgs(request, target), {
    stdio: ["ignore", "pipe", "pipe"],
  });

  writeJsonLine(response, {
    type: "bridge.started",
    pid: child.pid ?? null,
    target_id: target.id,
  });

  let stdoutBuffer = "";
  let stderrBuffer = "";
  let aborted = false;
  let lastAgentMessage: string | null = null;
  const messageState = {
    activeItemId: null as string | null,
    content: "",
  };

  const abort = (): void => {
    aborted = true;
    child.kill("SIGTERM");
  };

  response.once("close", abort);

  child.stdout?.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split("\n");
    stdoutBuffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>;
        const agentMessage = extractAgentMessage(event, messageState);
        if (agentMessage) {
          lastAgentMessage = agentMessage;
        }
      } catch {
        logger.debug("Ignoring non-json stdout from remote codex job");
      }

      response.write(`${trimmed}\n`);
    }
  });

  child.stderr?.on("data", (chunk) => {
    stderrBuffer += chunk.toString();
  });

  await new Promise<void>((resolve) => {
    child.once("error", (error) => {
      writeJsonLine(response, {
        type: "bridge.finished",
        status: aborted ? "cancelled" : "failed",
        summary: error.message,
      });
      response.end();
      resolve();
    });

    child.once("close", (exitCode, signal) => {
      if (stdoutBuffer.trim()) {
        response.write(`${stdoutBuffer.trim()}\n`);
      }

      const cancelled = aborted || signal === "SIGTERM";
      const status =
        cancelled
          ? "cancelled"
          : exitCode === 0
            ? "succeeded"
            : "failed";
      const summary =
        cancelled
          ? "Cancelled by user"
          : exitCode === 0
            ? (lastAgentMessage ?? "codex exec completed")
            : (stderrBuffer.trim() ||
              lastAgentMessage ||
              `remote codex exec failed with exit code ${exitCode ?? 1}`);

      writeJsonLine(response, {
        type: "bridge.finished",
        status,
        summary,
      });
      response.end();
      resolve();
    });
  });
}

async function readBody(request: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

function parseExecuteRequest(raw: string): BridgeExecuteRequest {
  const parsed = JSON.parse(raw) as Partial<BridgeExecuteRequest>;
  if (
    typeof parsed.jobId !== "string" ||
    typeof parsed.prompt !== "string" ||
    typeof parsed.targetId !== "string" ||
    typeof parsed.sourceRepo !== "string"
  ) {
    throw new Error("Invalid bridge execute request");
  }

  return {
    jobId: parsed.jobId,
    prompt: parsed.prompt,
    targetId: parsed.targetId,
    sourceRepo: parsed.sourceRepo,
    threadId: typeof parsed.threadId === "string" ? parsed.threadId : undefined,
    fullAuto: parsed.fullAuto === true,
    sandbox: parsed.sandbox,
  };
}

function isAuthorized(
  request: http.IncomingMessage,
  authToken: string | undefined,
): boolean {
  if (!authToken) {
    return true;
  }

  return request.headers.authorization === `Bearer ${authToken}`;
}

function writeJsonLine(
  response: http.ServerResponse,
  payload: Record<string, unknown>,
): void {
  response.write(`${JSON.stringify(payload)}\n`);
}

function json(
  response: http.ServerResponse,
  statusCode: number,
  body: unknown,
): void {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body, null, 2));
}

const REMOTE_CODEX_RUNNER_SCRIPT = String.raw`
import shutil
import subprocess
import sys
import threading
from pathlib import Path

source_repo = sys.argv[1]
workspace_root = sys.argv[2]
job_id = sys.argv[3]
prompt = sys.argv[4]
thread_id = sys.argv[5]
codex_bin = sys.argv[6]
full_auto = sys.argv[7] == "true"
sandbox = sys.argv[8]

workspace_dir = Path(workspace_root).expanduser() / f"job-{job_id}"
workspace_dir.parent.mkdir(parents=True, exist_ok=True)
shutil.rmtree(workspace_dir, ignore_errors=True)

subprocess.run(
    ["git", "clone", "--quiet", source_repo, str(workspace_dir)],
    check=True,
)

args = [codex_bin, "exec"]
if thread_id:
    args.extend(["resume", thread_id, "--json"])
    if full_auto:
        args.append("--full-auto")
else:
    args.append("--json")
    if full_auto:
        args.append("--full-auto")
    elif sandbox:
        args.extend(["--sandbox", sandbox])

args.append(prompt)

process = subprocess.Popen(
    args,
    cwd=str(workspace_dir),
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
)

stderr_parts = []

def drain_stderr():
    while True:
        chunk = process.stderr.readline()
        if not chunk:
            break
        stderr_parts.append(chunk.decode("utf-8", "replace"))

stderr_thread = threading.Thread(target=drain_stderr, daemon=True)
stderr_thread.start()

try:
    while True:
        chunk = process.stdout.readline()
        if not chunk:
            break
        try:
            sys.stdout.buffer.write(chunk)
            sys.stdout.buffer.flush()
        except BrokenPipeError:
            process.terminate()
            raise
finally:
    return_code = process.wait()
    stderr_thread.join(timeout=1)

if return_code != 0:
    sys.stderr.write("".join(stderr_parts).strip() or f"codex exited with {return_code}")
    sys.stderr.flush()
    sys.exit(return_code)
`;
