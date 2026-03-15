import type { JobRecord, JobResult } from "./types.js";
import { createLocalRunner } from "./runner.js";
import type { Logger } from "../util/logger.js";

type CodexExecutor = {
  run(job: JobRecord): Promise<JobResult>;
};

export function createCodexExecutor(
  codexBin: string,
  logger: Logger,
): CodexExecutor {
  const runner = createLocalRunner();

  return {
    async run(job) {
      return await new Promise<JobResult>((resolve) => {
        const child = runner.spawn(
          codexBin,
          ["exec", "--jsonl", job.prompt],
          { stdio: ["ignore", "pipe", "pipe"] },
        );

        let summary = "completed";
        let stderr = "";
        let stdoutBuffer = "";
        let settled = false;

        const resolveOnce = (result: JobResult): void => {
          if (settled) {
            return;
          }

          settled = true;
          resolve(result);
        };

        child.stdout?.on("data", (chunk) => {
          stdoutBuffer += chunk.toString();

          const lines = stdoutBuffer.split("\n");
          stdoutBuffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.trim()) {
              continue;
            }

            try {
              const event = JSON.parse(line) as {
                type?: string;
                message?: string;
              };
              if (event.type === "final" && event.message) {
                summary = event.message;
              }
            } catch {
              logger.debug(`Ignoring non-JSONL output for job ${job.id}`);
            }
          }
        });

        child.stderr?.on("data", (chunk) => {
          stderr += chunk.toString();
        });

        child.once("error", (error) => {
          resolveOnce({
            status: "failed",
            summary: error.message,
            finishedAt: new Date().toISOString(),
          });
        });

        child.once("close", (exitCode) => {
          if (stdoutBuffer.trim()) {
            try {
              const event = JSON.parse(stdoutBuffer) as {
                type?: string;
                message?: string;
              };
              if (event.type === "final" && event.message) {
                summary = event.message;
              }
            } catch {
              logger.debug(`Ignoring trailing non-JSONL output for job ${job.id}`);
            }
          }

          if (exitCode === 0) {
            resolveOnce({
              status: "succeeded",
              summary,
              finishedAt: new Date().toISOString(),
            });
            return;
          }

          resolveOnce({
            status: "failed",
            summary: stderr.trim() || "codex exec failed",
            finishedAt: new Date().toISOString(),
          });
        });
      });
    },
  };
}
