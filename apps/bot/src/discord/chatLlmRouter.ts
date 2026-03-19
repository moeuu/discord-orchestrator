import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createLocalRunner, type Runner } from "../jobs/runner.js";
import type { Logger } from "../util/logger.js";
import type { ChatSessionStore } from "./chatSessionStore.js";

export type ChatMentionAction =
  | {
      action: "reply";
      message: string;
      shell_command: string;
      codex_prompt: string;
      rationale: string;
    }
  | {
      action: "shell";
      message: string;
      shell_command: string;
      codex_prompt: string;
      rationale: string;
    }
  | {
      action: "codex";
      message: string;
      shell_command: string;
      codex_prompt: string;
      rationale: string;
    };

type ChatLlmRouterConfig = {
  codexBin: string;
  model: string;
  workdir: string;
  sessions: ChatSessionStore;
};

type RouteInput = {
  content: string;
  sessionKey: string;
  botUserId?: string;
  botRoleIds?: string[];
  resetSession?: boolean;
};

export function createChatLlmRouter(
  config: ChatLlmRouterConfig,
  logger: Logger,
  runner: Runner = createLocalRunner(),
): { route(input: RouteInput): Promise<ChatMentionAction> } {
  return {
    async route({
      content,
      sessionKey,
      botUserId,
      botRoleIds,
      resetSession = false,
    }) {
      const prompt = stripMention(content, botUserId, botRoleIds).trim();

      if (!prompt) {
        return {
          action: "reply",
          message: "内容が空でした。もう一度送ってください。",
          shell_command: "",
          codex_prompt: "",
          rationale: "empty_input",
        };
      }

      if (resetSession) {
        await config.sessions.clear(sessionKey);
      }

      const existingSession = await config.sessions.get(sessionKey);
      const tempDir = await fs.mkdtemp(
        path.join(os.tmpdir(), "discord-codex-router-"),
      );
      const outputPath = path.join(tempDir, "router-output.json");

      try {
        const args = existingSession
          ? buildChatResumeArgs(
              existingSession.threadId,
              config.model,
              outputPath,
              prompt,
            )
          : buildChatExecArgs(config.model, outputPath, prompt);

        const result = await runner.run(config.codexBin, args, {
          cwd: config.workdir,
          stdio: ["ignore", "pipe", "pipe"],
        });

        if (result.exitCode !== 0) {
          logger.error("Chat LLM router failed", {
            exitCode: result.exitCode,
            stderr: result.stderr.trim(),
            resumed: Boolean(existingSession),
          });
          throw new Error(
            result.stderr.trim() || `codex exec failed with exit code ${result.exitCode}`,
          );
        }

        const output = await fs.readFile(outputPath, "utf8");
        const action = parseChatMentionAction(output);
        const threadId = extractThreadId(result.stdout) ?? existingSession?.threadId;
        if (threadId) {
          await config.sessions.set(sessionKey, threadId);
        }

        logger.info("Chat LLM routed mention", {
          model: config.model,
          action: action.action,
          rationale: action.rationale,
          sessionKey,
          threadId,
          resumed: Boolean(existingSession),
          resetSession,
        });

        return action;
      } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    },
  };
}

export function buildChatExecArgs(
  model: string,
  outputPath: string,
  prompt: string,
): string[] {
  return [
    "exec",
    "--json",
    "--model",
    model,
    "--sandbox",
    "read-only",
    "--output-last-message",
    outputPath,
    buildRouterPrompt(prompt),
  ];
}

export function buildChatResumeArgs(
  threadId: string,
  model: string,
  outputPath: string,
  prompt: string,
): string[] {
  return [
    "exec",
    "resume",
    threadId,
    "--json",
    "--model",
    model,
    "--output-last-message",
    outputPath,
    buildRouterPrompt(prompt),
  ];
}

export function extractThreadId(stdout: string): string | null {
  const lines = stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      if (
        event.type === "thread.started" &&
        typeof event.thread_id === "string"
      ) {
        return event.thread_id;
      }
    } catch {
      continue;
    }
  }

  return null;
}

export function parseChatMentionAction(
  content: string | null | undefined,
): ChatMentionAction {
  if (!content) {
    throw new Error("Chat LLM returned empty content");
  }

  const normalized = content
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/, "");

  const parsed = JSON.parse(normalized) as Partial<ChatMentionAction>;

  if (
    parsed.action !== "reply" &&
    parsed.action !== "shell" &&
    parsed.action !== "codex"
  ) {
    throw new Error("Chat LLM returned unknown action");
  }

  return {
    action: parsed.action,
    message: typeof parsed.message === "string" ? parsed.message : "",
    shell_command:
      typeof parsed.shell_command === "string" ? parsed.shell_command : "",
    codex_prompt:
      typeof parsed.codex_prompt === "string" ? parsed.codex_prompt : "",
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
  };
}

export function shouldResetChatSession(content: string): boolean {
  return /(新しいセッション|セッションをリセット|会話をリセット|reset session)/i.test(
    content,
  );
}

function buildRouterPrompt(userPrompt: string): string {
  return [
    "You route Discord mentions for a local automation bot.",
    "Return only a JSON object with exactly these keys:",
    'action ("reply" | "shell" | "codex"), message, shell_command, codex_prompt, rationale.',
    'Choose action="reply" for normal questions, unclear requests, or unsafe actions.',
    'Choose action="shell" when the user clearly wants a local shell command executed.',
    'Choose action="codex" for broader coding or agent tasks better handled by codex.',
    "Never choose shell for destructive commands such as rm -rf, sudo, mkfs, dd, reboot, poweroff, or git reset --hard.",
    "If the request is ambiguous, choose reply and ask a short clarification.",
    "Set message to what the bot should say back to the user.",
    "Return JSON only. No markdown.",
    "User message:",
    userPrompt,
  ].join("\n");
}

function stripMention(
  content: string,
  botUserId?: string,
  botRoleIds: string[] = [],
): string {
  let normalized = content;

  if (botUserId) {
    normalized = normalized.replace(
      new RegExp(`<@!?${escapeRegExp(botUserId)}>`, "g"),
      "",
    );
  }

  for (const roleId of botRoleIds) {
    normalized = normalized.replace(
      new RegExp(`<@&${escapeRegExp(roleId)}>`, "g"),
      "",
    );
  }

  return normalized.trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
