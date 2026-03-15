import fs from "node:fs/promises";
import path from "node:path";

import type { Logger } from "../util/logger.js";
import { createLocalRunner, type Runner } from "./runner.js";
import type { JobRecord, JobResult } from "./types.js";

export type ShellExecConfig = {
  workdir: string;
};

type ShellExecInput = {
  command: string;
};

type ShellExecOptions = {
  signal?: AbortSignal;
  onPid?: (pid: number) => Promise<void> | void;
};

type ShellExecutor = {
  run(
    job: JobRecord,
    input: ShellExecInput,
    options?: ShellExecOptions,
  ): Promise<JobResult>;
};

export function createShellExecutor(
  config: ShellExecConfig,
  logger: Logger,
  runner: Runner = createLocalRunner(),
): ShellExecutor {
  return {
    async run(job, input, options = {}) {
      return await new Promise((resolve) => {
        const child = runner.spawn(input.command, [], {
          cwd: config.workdir,
          shell: true,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let stdoutBuffer = "";
        let stderrBuffer = "";
        let logQueue = Promise.resolve();

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
          const text = chunk.toString();
          stdoutBuffer += text;
          logQueue = logQueue.then(() => appendLog(job.log_path, text));
        });

        child.stderr?.on("data", (chunk) => {
          const text = chunk.toString();
          stderrBuffer += text;
          logQueue = logQueue.then(() => appendLog(job.log_path, text));
        });

        child.once("error", (error) => {
          logger.warn(`Shell command failed to start for ${job.id}`, error);
          resolve({
            status: options.signal?.aborted ? "cancelled" : "failed",
            summary: error.message,
            finished_at: new Date().toISOString(),
          });
        });

        child.once("close", (exitCode, signal) => {
          void logQueue.finally(() => {
            if (options.signal) {
              options.signal.removeEventListener("abort", handleAbort);
            }

            if (options.signal?.aborted || signal === "SIGTERM") {
              resolve({
                status: "cancelled",
                summary: "Shell command cancelled",
                finished_at: new Date().toISOString(),
              });
              return;
            }

            if (exitCode === 0) {
              resolve({
                status: "succeeded",
                summary: summarizeOutput(stdoutBuffer) ?? "Shell command completed",
                finished_at: new Date().toISOString(),
              });
              return;
            }

            resolve({
              status: "failed",
              summary:
                summarizeOutput(stderrBuffer) ??
                summarizeOutput(stdoutBuffer) ??
                `Shell command failed with exit code ${exitCode ?? 1}`,
              finished_at: new Date().toISOString(),
            });
          });
        });
      });
    },
  };
}

async function appendLog(logPath: string | undefined, text: string): Promise<void> {
  if (!logPath) {
    return;
  }

  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, text, "utf8");
}

function summarizeOutput(value: string): string | null {
  const lines = value
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return null;
  }

  const latest = lines[lines.length - 1];
  return latest.length <= 160 ? latest : `${latest.slice(0, 157)}...`;
}
