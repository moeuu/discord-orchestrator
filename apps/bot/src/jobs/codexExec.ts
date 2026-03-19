import fs from "node:fs/promises";
import path from "node:path";

import type { Logger } from "../util/logger.js";
import { createLocalRunner, type Runner } from "./runner.js";
import type { JobProgress, JobRecord, JobResult } from "./types.js";

export type CodexExecSandboxMode =
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

export type CodexRunOptions = {
  signal?: AbortSignal;
  onPid?: (pid: number) => Promise<void> | void;
  onEvent?: (event: CodexEvent, meta: { agentMessage: string | null }) => Promise<void> | void;
};

export type CodexExecutor = {
  run(job: JobRecord, options?: CodexRunOptions): Promise<JobResult>;
};

type AgentMessageState = {
  activeItemId: string | null;
  content: string;
};

const RECENT_CODEX_LOG_LIMIT = 5;

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
        threadId: job.external_id,
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
    threadId?: string;
    fullAuto?: boolean;
    sandbox?: CodexExecSandboxMode;
  } = {},
): string[] {
  if (options.threadId) {
    const args = ["exec", "resume", options.threadId, "--json"];

    if (options.fullAuto) {
      args.push("--full-auto");
    }

    args.push(prompt);
    return args;
  }

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

  const preferredOrigin = await resolvePreferredOriginUrl(runner, sourceRepo);
  if (preferredOrigin) {
    const setRemote = await runner.run(
      "git",
      ["remote", "set-url", "origin", preferredOrigin],
      {
        cwd: workspaceDir,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    if (setRemote.exitCode !== 0) {
      throw new Error(setRemote.stderr.trim() || "git remote set-url failed");
    }
  }
}

export function extractAgentMessage(
  event: CodexEvent,
  state?: AgentMessageState,
): string | null {
  const eventType = typeof event.type === "string" ? event.type : null;
  const item = event.item && typeof event.item === "object"
    ? (event.item as Record<string, unknown>)
    : null;
  const itemType = typeof item?.type === "string" ? item.type : null;
  const lastMessage = extractText(event.last_agent_message);
  if (lastMessage) {
    if (state) {
      state.activeItemId = null;
      state.content = lastMessage;
    }
    return lastMessage;
  }

  if (
    (eventType === "item.completed" || eventType === "item.started") &&
    itemType === "agent_message"
  ) {
    const message =
      extractText(item?.text) ??
      extractText(item?.message) ??
      extractText(item?.content);

    if (message && state) {
      state.activeItemId = typeof item?.id === "string" ? item.id : null;
      state.content = message;
    }

    return message;
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

export function buildCodexProgress(
  previous: JobProgress | undefined,
  event: CodexEvent,
  agentMessage: string | null,
): JobProgress {
  const next: JobProgress = {
    ...(previous ?? {}),
    updated_at: new Date().toISOString(),
  };
  const eventType = typeof event.type === "string" ? event.type : null;
  const commandState = getCommandExecutionState(event);
  const activity = describeCodexActivity(event, agentMessage);
  const logLine = describeCodexLogEvent(event, agentMessage);

  if (agentMessage) {
    next.latest_agent_message = agentMessage;
  }

  if (activity) {
    next.activity = activity;
  }

  if (commandState?.status === "started") {
    next.active_command = commandState.command;
  } else if (commandState?.status === "completed") {
    delete next.active_command;
  } else if (eventType === "turn.completed" || eventType === "task_complete") {
    delete next.active_command;
  }

  const phase = describeCodexPhase(event, agentMessage);
  if (phase) {
    next.phase = phase;
  }

  if (logLine) {
    const current = Array.isArray(previous?.recent_logs)
      ? previous.recent_logs
      : [];
    const deduped =
      current[current.length - 1] === logLine
        ? current
        : [...current, logLine].slice(-RECENT_CODEX_LOG_LIMIT);
    next.recent_logs = deduped;
  } else if (previous?.recent_logs) {
    next.recent_logs = previous.recent_logs;
  }

  return next;
}

export function renderCodexLogPreview(
  contents: string,
  limit = RECENT_CODEX_LOG_LIMIT,
): string | null {
  const lines = contents
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return null;
  }

  const state: AgentMessageState = {
    activeItemId: null,
    content: "",
  };
  const rendered: string[] = [];

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as CodexEvent;
      const agentMessage = extractAgentMessage(event, state);
      const summary = describeCodexLogEvent(event, agentMessage);
      if (summary) {
        rendered.push(summary);
      }
    } catch {
      continue;
    }
  }

  if (rendered.length === 0) {
    return null;
  }

  return rendered.slice(-limit).join("\n");
}

async function appendJsonLine(logPath: string, event: CodexEvent): Promise<void> {
  await fs.appendFile(logPath, `${JSON.stringify(event)}\n`, "utf8");
}

function describeCodexPhase(
  event: CodexEvent,
  agentMessage: string | null,
): string | null {
  const eventType = typeof event.type === "string" ? event.type : null;
  const commandState = getCommandExecutionState(event);

  if (commandState?.status === "started") {
    return "コマンド実行中";
  }

  if (commandState?.status === "completed") {
    return "コマンド結果を確認中";
  }

  if (
    eventType === "agent_message" ||
    eventType === "agent_message_delta" ||
    eventType === "agent_message_content_delta"
  ) {
    return "考え中";
  }

  if (
    (eventType === "item.started" || eventType === "item.completed") &&
    getItemType(event) === "agent_message"
  ) {
    return "考え中";
  }

  if (eventType === "thread.started") {
    return "セッション開始";
  }

  if (eventType === "turn.started") {
    return "依頼を処理中";
  }

  if (eventType === "turn.completed" || eventType === "task_complete") {
    return agentMessage ? "応答完了" : "完了";
  }

  return null;
}

function describeCodexActivity(
  event: CodexEvent,
  agentMessage: string | null,
): string | null {
  const eventType = typeof event.type === "string" ? event.type : null;
  const commandState = getCommandExecutionState(event);

  if (commandState?.status === "started") {
    return `実行中: ${commandState.command}`;
  }

  if (commandState?.status === "completed") {
    return `コマンド完了: ${commandState.command}`;
  }

  if (
    eventType === "agent_message" ||
    eventType === "agent_message_delta" ||
    eventType === "agent_message_content_delta" ||
    ((eventType === "item.started" || eventType === "item.completed") &&
      getItemType(event) === "agent_message")
  ) {
    return agentMessage ? truncateSingleLine(agentMessage, 240) : "Codex が考えています";
  }

  if (eventType === "thread.started") {
    return "Codex セッションを開始しました";
  }

  if (eventType === "turn.started") {
    return "Codex が依頼を処理しています";
  }

  if (eventType === "turn.completed" || eventType === "task_complete") {
    return agentMessage
      ? truncateSingleLine(agentMessage, 240)
      : "Codex が応答を返しました";
  }

  return null;
}

function describeCodexLogEvent(
  event: CodexEvent,
  agentMessage: string | null,
): string | null {
  const eventType = typeof event.type === "string" ? event.type : null;
  const commandState = getCommandExecutionState(event);

  if (eventType === "thread.started") {
    return "セッションを開始";
  }

  if (eventType === "turn.started") {
    return "依頼の処理を開始";
  }

  if (commandState?.status === "started") {
    return `実行開始: ${commandState.command}`;
  }

  if (commandState?.status === "completed") {
    return `実行完了(${commandState.exitCode ?? "?"}): ${commandState.command}`;
  }

  if (
    eventType === "item.completed" &&
    getItemType(event) === "agent_message" &&
    agentMessage
  ) {
    return `考え: ${truncateSingleLine(agentMessage, 180)}`;
  }

  if (eventType === "task_complete" || eventType === "turn.completed") {
    return agentMessage
      ? `応答完了: ${truncateSingleLine(agentMessage, 180)}`
      : "応答完了";
  }

  return null;
}

function getItemType(event: CodexEvent): string | null {
  const item = event.item && typeof event.item === "object"
    ? (event.item as Record<string, unknown>)
    : null;
  return typeof item?.type === "string" ? item.type : null;
}

function getCommandExecutionState(
  event: CodexEvent,
):
  | {
    status: "started" | "completed";
    command: string;
    exitCode?: number | null;
  }
  | null {
  const eventType = typeof event.type === "string" ? event.type : null;
  if (eventType !== "item.started" && eventType !== "item.completed") {
    return null;
  }

  const item = event.item && typeof event.item === "object"
    ? (event.item as Record<string, unknown>)
    : null;
  if (!item || item.type !== "command_execution") {
    return null;
  }

  const rawCommand =
    typeof item.command === "string" ? item.command : null;
  if (!rawCommand) {
    return null;
  }

  return {
    status: eventType === "item.started" ? "started" : "completed",
    command: normalizeCommand(rawCommand),
    exitCode: typeof item.exit_code === "number" ? item.exit_code : null,
  };
}

function normalizeCommand(command: string): string {
  const trimmed = command.trim();
  const shellMatch = trimmed.match(
    /^(?:\/bin\/(?:zsh|bash)|zsh|bash)\s+-lc\s+(['"])([\s\S]*)\1$/,
  );
  const normalized = shellMatch?.[2] ?? trimmed;
  return truncateSingleLine(normalized, 180);
}

function truncateSingleLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, maxLength - 3)}...`;
}

async function resolvePreferredOriginUrl(
  runner: Runner,
  sourceRepo: string,
): Promise<string | null> {
  if (looksLikeRemoteUrl(sourceRepo)) {
    return normalizeGithubRemoteUrl(sourceRepo);
  }

  const currentOrigin = await runner.run(
    "git",
    ["remote", "get-url", "origin"],
    {
      cwd: sourceRepo,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  if (currentOrigin.exitCode !== 0) {
    return null;
  }

  const raw = currentOrigin.stdout.trim();
  if (!raw || !looksLikeRemoteUrl(raw)) {
    return null;
  }

  return normalizeGithubRemoteUrl(raw);
}

function looksLikeRemoteUrl(value: string): boolean {
  return (
    value.startsWith("git@") ||
    value.startsWith("ssh://") ||
    value.startsWith("https://") ||
    value.startsWith("http://")
  );
}

function normalizeGithubRemoteUrl(value: string): string {
  const httpsMatch = value.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  );
  if (httpsMatch) {
    return `git@github.com:${httpsMatch[1]}/${httpsMatch[2]}.git`;
  }

  const sshUrlMatch = value.match(
    /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  );
  if (sshUrlMatch) {
    return `git@github.com:${sshUrlMatch[1]}/${sshUrlMatch[2]}.git`;
  }

  return value;
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
