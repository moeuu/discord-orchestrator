import fs from "node:fs/promises";
import path from "node:path";

import type { Logger } from "../util/logger.js";
import type { CodexTarget } from "../targets.js";
import { resolveCodexTarget } from "../targets.js";
import {
  extractAgentMessage,
  type CodexEvent,
  type CodexExecConfig,
  type CodexExecutor,
  type CodexRunOptions,
} from "./codexExec.js";
import type { JobRecord, JobResult } from "./types.js";

type BridgeCodexEvent =
  | {
      type: "bridge.started";
      pid?: number | null;
      target_id?: string;
    }
  | {
      type: "bridge.finished";
      status?: JobResult["status"];
      summary?: string;
    };

export function createBridgeCodexExecutor(
  config: CodexExecConfig & {
    bridgeAuthToken?: string;
    targets: CodexTarget[];
  },
  logger: Logger,
): CodexExecutor {
  return {
    async run(job, options = {}) {
      const target = resolveCodexTarget(config.targets, job.runner_id);
      if (!target || target.transport !== "bridge" || !target.bridgeBaseUrl) {
        throw new Error(`Unknown bridge target: ${job.runner_id ?? "unset"}`);
      }

      const logPath = job.log_path ?? path.join(path.dirname(config.workspaceRoot), "logs", `job-${job.id}.jsonl`);
      await fs.mkdir(path.dirname(logPath), { recursive: true });

      const response = await fetch(
        `${target.bridgeBaseUrl.replace(/\/$/, "")}/v1/jobs/execute`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(config.bridgeAuthToken
              ? { authorization: `Bearer ${config.bridgeAuthToken}` }
              : {}),
          },
          body: JSON.stringify({
            jobId: job.id,
            prompt: job.prompt,
            targetId: target.id,
            sourceRepo: config.sourceRepo,
            threadId: job.external_id,
            fullAuto: config.fullAuto,
            sandbox: config.sandbox,
          }),
          signal: options.signal,
        },
      ).catch((error) => {
        if (isAbortError(error)) {
          return null;
        }

        throw error;
      });

      if (!response) {
        return cancelledResult();
      }

      if (!response.ok || !response.body) {
        const body = await response.text().catch(() => "");
        return {
          status: "failed",
          summary: body.trim() || `bridge request failed with status ${response.status}`,
          finished_at: new Date().toISOString(),
        };
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let lastAgentMessage: string | null = null;
      let finalStatus: JobResult["status"] = "succeeded";
      let finalSummary = "codex exec completed";
      const messageState = {
        activeItemId: null as string | null,
        content: "",
      };

      while (true) {
        let chunk;
        try {
          chunk = await reader.read();
        } catch (error) {
          if (isAbortError(error)) {
            return cancelledResult(lastAgentMessage);
          }

          throw error;
        }

        if (chunk.done) {
          break;
        }

        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) {
            continue;
          }

          const parsed = JSON.parse(trimmed) as CodexEvent | BridgeCodexEvent;
          if (parsed.type === "bridge.started") {
            if (typeof parsed.pid === "number") {
              await options.onPid?.(parsed.pid);
            }
            continue;
          }

          if (parsed.type === "bridge.finished") {
            const finished = parsed as Extract<
              BridgeCodexEvent,
              { type: "bridge.finished" }
            >;
            finalStatus = finished.status ?? "failed";
            finalSummary = finished.summary ?? finalSummary;
            continue;
          }

          await fs.appendFile(logPath, `${trimmed}\n`, "utf8");
          const agentMessage = extractAgentMessage(parsed, messageState);
          if (agentMessage) {
            lastAgentMessage = agentMessage;
          }

          await options.onEvent?.(parsed, {
            agentMessage: agentMessage ?? lastAgentMessage,
          });
        }
      }

      return {
        status: finalStatus,
        summary: finalSummary || lastAgentMessage || "codex exec completed",
        finished_at: new Date().toISOString(),
      };
    },
  };
}

function cancelledResult(summary?: string | null): JobResult {
  return {
    status: "cancelled",
    summary: summary ?? "Cancelled by user",
    finished_at: new Date().toISOString(),
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
