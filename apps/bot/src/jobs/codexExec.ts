import fs from "node:fs/promises";
import path from "node:path";

import type { Logger } from "../util/logger.js";
import { createLocalRunner, type Runner } from "./runner.js";
import type { JobRecord, JobResult } from "./types.js";

type CodexExecSandboxMode =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

export type CodexExecConfig = {
  codexBin: string;
  workspaceRoot: string;
  sourceRepo: string;
  fullAuto?: boolean;
  sandbox?: CodexExecSandboxMode;
};

export type CodexEvent = Record<string, unknown>;

type CodexRunOptions = {
  signal?: AbortSignal;
  onPid?: (pid: number) => Promise<void> | void;
  onEvent?: (event: CodexEvent, meta: { agentMessage: string | null }) => Promise<void> | void;
};

type CodexExecutor = {
  run(job: JobRecord, options?: CodexRunOptions): Promise<JobResult>;
};

type AgentMessageState = {
  activeItemId: string | null;
  content: string;
};

export function createCodexExecutor(
  config: CodexExecConfig,
  logger: Logger,
  runner: Runner = createLocalRunner(),
): CodexExecutor {
  return {
    async run(job, options = {}) {
      const workspaceDir = resolveWorkspaceDir(config.workspaceRoot, job.id);
      const logPath = job.log_path ?? path.join(path.dirname(config.workspaceRoot), "logs", `job-${job.id}.jsonl`);

      await prepareWorkspace(runner, config.sourceRepo, workspaceDir);
      await fs.mkdir(path.dirname(logPath), { recursive: true });

      const args = buildCodexExecArgs(job.prompt, {
        fullAuto: config.fullAuto,
        sandbox: config.sandbox,
      });

      return await new Promise<JobResult>((resolve) => {
        const child = runner.spawn(config.codexBin, args, {
          cwd: workspaceDir,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stderr = "";
        let stdoutBuffer = "";
        let settled = false;
        let lastAgentMessage: string | null = null;
        let messageState: AgentMessageState = {
          activeItemId: null,
          content: "",
        };
        let processingChain = Promise.resolve();

        const resolveOnce = (result: JobResult): void => {
          if (settled) {
            return;
          }

          settled = true;
          resolve(result);
        };

        const handleAbort = (): void => {
          child.kill("SIGTERM");
        };

        if (options.signal) {
          if (options.signal.aborted) {
            handleAbort();
          } else {
            options.signal.addEventListener("abort", handleAbort, { once: true });
          }
        }

        if (child.pid) {
          void options.onPid?.(child.pid);
        }

        child.stdout?.on("data", (chunk) => {
          stdoutBuffer += chunk.toString();

          const lines = stdoutBuffer.split("\n");
          stdoutBuffer = lines.pop() ?? "";

          for (const line of lines) {
            processingChain = processingChain
              .then(() => handleStdoutLine(line))
              .catch((error) => {
                logger.warn(`Failed to handle codex event for job ${job.id}`, error);
              });
          }
        });

        child.stderr?.on("data", (chunk) => {
          stderr += chunk.toString();
        });

        child.once("error", (error) => {
          resolveOnce({
            status: options.signal?.aborted ? "cancelled" : "failed",
            summary: error.message,
            finished_at: new Date().toISOString(),
          });
        });

        child.once("close", (exitCode, signal) => {
          if (stdoutBuffer.trim()) {
            processingChain = processingChain
              .then(() => handleStdoutLine(stdoutBuffer.trim()))
              .catch((error) => {
                logger.warn(
                  `Failed to handle trailing codex event for job ${job.id}`,
                  error,
                );
              });
          }

          void processingChain.finally(() => {
            if (options.signal) {
              options.signal.removeEventListener("abort", handleAbort);
            }

            if (options.signal?.aborted || signal === "SIGTERM") {
              resolveOnce({
                status: "cancelled",
                summary: lastAgentMessage ?? "Cancelled by user",
                finished_at: new Date().toISOString(),
              });
              return;
            }

            if (exitCode === 0) {
              resolveOnce({
                status: "succeeded",
                summary: lastAgentMessage ?? "codex exec completed",
                finished_at: new Date().toISOString(),
              });
              return;
            }

            resolveOnce({
              status: "failed",
              summary: stderr.trim() || lastAgentMessage || "codex exec failed",
              finished_at: new Date().toISOString(),
            });
          });
        });

        async function handleStdoutLine(line: string): Promise<void> {
          if (!line.trim()) {
            return;
          }

          try {
            const event = JSON.parse(line) as CodexEvent;
            await appendJsonLine(logPath, event);

            const agentMessage = extractAgentMessage(event, messageState);
            if (agentMessage) {
              lastAgentMessage = agentMessage;
            }

            await options.onEvent?.(event, {
              agentMessage: agentMessage ?? lastAgentMessage,
            });
          } catch {
            logger.debug(`Ignoring non-JSON output for job ${job.id}`);
          }
        }
      });
    },
  };
}

export function buildCodexExecArgs(
  prompt: string,
  options: {
    fullAuto?: boolean;
    sandbox?: CodexExecSandboxMode;
  } = {},
): string[] {
  const args = ["exec", "--json"];

  if (options.fullAuto) {
    args.push("--full-auto");
  } else if (options.sandbox) {
    args.push("--sandbox", options.sandbox);
  }

  args.push(prompt);
  return args;
}

export function resolveWorkspaceDir(workspaceRoot: string, jobId: string): string {
  return path.join(workspaceRoot, `job-${jobId}`);
}

export async function prepareWorkspace(
  runner: Runner,
  sourceRepo: string,
  workspaceDir: string,
): Promise<void> {
  await fs.rm(workspaceDir, { recursive: true, force: true });
  await fs.mkdir(path.dirname(workspaceDir), { recursive: true });

  const clone = await runner.run(
    "git",
    ["clone", "--quiet", sourceRepo, workspaceDir],
    {
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (clone.exitCode !== 0) {
    throw new Error(clone.stderr.trim() || "git clone failed");
  }
}

export function extractAgentMessage(
  event: CodexEvent,
  state?: AgentMessageState,
): string | null {
  const eventType = typeof event.type === "string" ? event.type : null;
  const lastMessage = extractText(event.last_agent_message);
  if (lastMessage) {
    if (state) {
      state.activeItemId = null;
      state.content = lastMessage;
    }
    return lastMessage;
  }

  if (eventType === "agent_message") {
    const message =
      extractText(event.message) ??
      extractText(event.content) ??
      extractText(event.text) ??
      extractText(event.item);

    if (message && state) {
      state.activeItemId = typeof event.item_id === "string" ? event.item_id : null;
      state.content = message;
    }

    return message;
  }

  if (
    eventType === "agent_message_delta" ||
    eventType === "agent_message_content_delta"
  ) {
    const delta = extractTextInternal(event.delta, {
      preserveWhitespace: true,
    });
    if (!delta || !state) {
      return delta;
    }

    const itemId = typeof event.item_id === "string" ? event.item_id : null;
    if (itemId && itemId !== state.activeItemId) {
      state.activeItemId = itemId;
      state.content = delta;
      return state.content;
    }

    state.content += delta;
    return state.content;
  }

  return null;
}

async function appendJsonLine(logPath: string, event: CodexEvent): Promise<void> {
  await fs.appendFile(logPath, `${JSON.stringify(event)}\n`, "utf8");
}

function extractText(value: unknown): string | null {
  return extractTextInternal(value, { preserveWhitespace: false });
}

function extractTextInternal(
  value: unknown,
  options: {
    preserveWhitespace: boolean;
  },
): string | null {
  if (typeof value === "string") {
    if (options.preserveWhitespace) {
      return value.length > 0 ? value : null;
    }

    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => extractTextInternal(item, options))
      .filter((item): item is string => Boolean(item));
    return parts.length > 0 ? parts.join("\n") : null;
  }

  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;

    const direct =
      extractTextInternal(record.text, options) ??
      extractTextInternal(record.message, options) ??
      extractTextInternal(record.content, options) ??
      extractTextInternal(record.delta, options) ??
      extractTextInternal(record.last_agent_message, options);

    if (direct) {
      return direct;
    }

    if (Array.isArray(record.content)) {
      const parts = record.content
        .map((item) => extractTextInternal(item, options))
        .filter((item): item is string => Boolean(item));
      return parts.length > 0 ? parts.join("\n") : null;
    }
  }

  return null;
}
