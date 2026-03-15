import fs from "node:fs/promises";
import path from "node:path";

import type { Logger } from "../util/logger.js";
import {
  createCodexExecutor,
  type CodexExecConfig,
  type CodexEvent,
} from "./codexExec.js";
import type { JobStore } from "./store.js";
import type { JobRecord, RunnerTarget } from "./types.js";

type JobUpdateHandler = (job: JobRecord) => Promise<void>;

type JobLogInfo = {
  job: JobRecord | null;
  preview: string | null;
};

type JobService = {
  createJob(input: {
    prompt: string;
    target: RunnerTarget;
    discordChannelId: string;
  }): Promise<JobRecord>;
  startJob(jobId: string, onUpdate: JobUpdateHandler): Promise<void>;
  cancelJob(jobId: string): Promise<JobRecord | null>;
  getJob(jobId?: string | null): Promise<JobRecord | null>;
  getLogInfo(jobId: string): Promise<JobLogInfo>;
};

type ActiveJob = {
  abortController: AbortController;
};

export function createJobService(
  store: JobStore,
  logDir: string,
  logger: Logger,
  codexConfig: CodexExecConfig,
): JobService {
  const activeJobs = new Map<string, ActiveJob>();
  const executor = createCodexExecutor(codexConfig, logger);

  return {
    async createJob({ prompt, target, discordChannelId }) {
      let job = await store.create({
        prompt,
        target,
        status: "queued",
        discord_channel_id: discordChannelId,
        summary: "Queued codex exec",
      });

      job = await ensureLogPath(store, logDir, job);
      return job;
    },
    async startJob(jobId, onUpdate) {
      const abortController = new AbortController();
      activeJobs.set(jobId, { abortController });

      try {
        let job = await store.get(jobId);
        if (!job) {
          throw new Error(`Job not found: ${jobId}`);
        }

        if (job.target !== "local") {
          throw new Error(`Unsupported target for local runner: ${job.target}`);
        }

        job = await ensureLogPath(store, logDir, job);
        job = await store.update(jobId, {
          status: "running",
          started_at: new Date().toISOString(),
          summary: "Preparing workspace clone",
        });
        await onUpdate(job);

        const result = await executor.run(job, {
          signal: abortController.signal,
          onPid: async (pid) => {
            const updated = await store.update(jobId, { pid });
            await onUpdate(updated);
          },
          onEvent: async (event, meta) => {
            const updated = await handleCodexEvent(
              store,
              jobId,
              event,
              meta.agentMessage,
            );

            if (updated) {
              await onUpdate(updated);
            }
          },
        });

        const finalJob = await store.update(jobId, {
          status: result.status,
          finished_at: result.finished_at,
          summary: result.summary,
        });
        await onUpdate(finalJob);
      } catch (error) {
        logger.error("Job execution failed", error);

        const failedJob = await store.get(jobId);
        if (failedJob) {
          const failed = await store.update(jobId, {
            status: "failed",
            finished_at: new Date().toISOString(),
            summary:
              error instanceof Error ? error.message : "codex exec failed",
          });
          await onUpdate(failed);
        }
      } finally {
        activeJobs.delete(jobId);
      }
    },
    async cancelJob(jobId) {
      const job = await store.get(jobId);
      if (!job) {
        return null;
      }

      const active = activeJobs.get(jobId);
      if (active) {
        active.abortController.abort();
        return await store.update(jobId, {
          summary: "Cancellation requested",
        });
      }

      if (job.status === "queued" || job.status === "running") {
        return await store.update(jobId, {
          status: "cancelled",
          finished_at: new Date().toISOString(),
          summary: "Cancelled before execution completed",
        });
      }

      return job;
    },
    async getJob(jobId) {
      if (jobId) {
        return await store.get(jobId);
      }

      const [latest] = await store.list(1);
      return latest ?? null;
    },
    async getLogInfo(jobId) {
      const job = await store.get(jobId);
      if (!job || !job.log_path) {
        return { job, preview: null };
      }

      try {
        const contents = await fs.readFile(job.log_path, "utf8");
        const preview = contents
          .trim()
          .split("\n")
          .slice(-10)
          .join("\n");

        return {
          job,
          preview: preview || null,
        };
      } catch {
        return {
          job,
          preview: null,
        };
      }
    },
  };
}

async function ensureLogPath(
  store: JobStore,
  logDir: string,
  job: JobRecord,
): Promise<JobRecord> {
  if (job.log_path) {
    return job;
  }

  const logPath = path.join(logDir, `job-${job.id}.jsonl`);
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.writeFile(logPath, "", "utf8");
  return await store.update(job.id, { log_path: logPath });
}

async function handleCodexEvent(
  store: JobStore,
  jobId: string,
  event: CodexEvent,
  agentMessage: string | null,
): Promise<JobRecord | null> {
  const patch: Partial<JobRecord> = {};

  if (agentMessage) {
    patch.summary = agentMessage;
  }

  if (typeof event.type === "string" && event.type === "task_complete") {
    patch.summary = agentMessage ?? patch.summary;
  }

  if (Object.keys(patch).length === 0) {
    return null;
  }

  const job = await store.get(jobId);
  if (!job) {
    return null;
  }

  if (patch.summary === job.summary) {
    return null;
  }

  return await store.update(jobId, patch);
}
