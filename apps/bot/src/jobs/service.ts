import fs from "node:fs/promises";
import path from "node:path";

import type { Logger } from "../util/logger.js";
import type { JobStore } from "./store.js";
import type { JobRecord, RunnerTarget } from "./types.js";

type JobUpdateHandler = (job: JobRecord) => Promise<void>;

type JobLogInfo = {
  job: JobRecord | null;
  preview: string | null;
};

type JobService = {
  createJob(input: { prompt: string; target: RunnerTarget }): Promise<JobRecord>;
  startDummyRun(jobId: string, onUpdate: JobUpdateHandler): Promise<void>;
  cancelJob(jobId: string): Promise<JobRecord | null>;
  getJob(jobId?: string | null): Promise<JobRecord | null>;
  getLogInfo(jobId: string): Promise<JobLogInfo>;
};

type ActiveJob = {
  cancelRequested: boolean;
};

const DUMMY_STEPS = [
  { delayMs: 1200, summary: "Checking workspace" },
  { delayMs: 1200, summary: "Preparing Codex prompt" },
  { delayMs: 1200, summary: "Streaming placeholder progress" },
];

export function createJobService(
  store: JobStore,
  logDir: string,
  logger: Logger,
): JobService {
  const activeJobs = new Map<string, ActiveJob>();

  return {
    async createJob({ prompt, target }) {
      let job = await store.create({
        prompt,
        target,
        status: "queued",
        summary: "Queued dummy run",
      });

      job = await ensureLogPath(store, logDir, job);
      await appendJobLog(job, "job created");
      return job;
    },
    async startDummyRun(jobId, onUpdate) {
      const controller: ActiveJob = { cancelRequested: false };
      activeJobs.set(jobId, controller);

      try {
        let job = await store.getByJobId(jobId);
        if (!job) {
          throw new Error(`Job not found: ${jobId}`);
        }

        job = await ensureLogPath(store, logDir, job);
        job = await store.update(jobId, {
          status: "running",
          startedAt: new Date().toISOString(),
          summary: "Starting dummy run",
        });

        await appendJobLog(job, "dummy run started");
        await onUpdate(job);

        for (const step of DUMMY_STEPS) {
          await sleep(step.delayMs);

          if (controller.cancelRequested) {
            const cancelled = await store.update(jobId, {
              status: "cancelled",
              finishedAt: new Date().toISOString(),
              summary: "Cancelled by user",
            });
            await appendJobLog(cancelled, "job cancelled");
            await onUpdate(cancelled);
            return;
          }

          job = await store.update(jobId, { summary: step.summary });
          await appendJobLog(job, step.summary);
          await onUpdate(job);
        }

        const finished = await store.update(jobId, {
          status: "succeeded",
          finishedAt: new Date().toISOString(),
          summary: "Dummy run completed",
        });
        await appendJobLog(finished, "dummy run completed");
        await onUpdate(finished);
      } catch (error) {
        logger.error("Dummy run failed", error);

        const failed = await store.update(jobId, {
          status: "failed",
          finishedAt: new Date().toISOString(),
          summary: error instanceof Error ? error.message : "dummy run failed",
        });
        await appendJobLog(failed, "dummy run failed");
        await onUpdate(failed);
      } finally {
        activeJobs.delete(jobId);
      }
    },
    async cancelJob(jobId) {
      const job = await store.getByJobId(jobId);
      if (!job) {
        return null;
      }

      const active = activeJobs.get(jobId);
      if (active) {
        active.cancelRequested = true;
        return await store.update(jobId, {
          summary: "Cancellation requested",
        });
      }

      if (job.status === "queued" || job.status === "running") {
        const cancelled = await store.update(jobId, {
          status: "cancelled",
          finishedAt: new Date().toISOString(),
          summary: "Cancelled before execution completed",
        });
        await appendJobLog(cancelled, "job cancelled");
        return cancelled;
      }

      return job;
    },
    async getJob(jobId) {
      if (jobId) {
        return await store.getByJobId(jobId);
      }

      return await store.getLatest();
    },
    async getLogInfo(jobId) {
      const job = await store.getByJobId(jobId);
      if (!job || !job.logPath) {
        return { job, preview: null };
      }

      try {
        const contents = await fs.readFile(job.logPath, "utf8");
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
  if (job.logPath) {
    return job;
  }

  const logPath = path.join(logDir, "jobs", `${job.jobId}.log`);
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  return await store.update(job.jobId, { logPath });
}

async function appendJobLog(job: JobRecord, line: string): Promise<void> {
  if (!job.logPath) {
    return;
  }

  await fs.mkdir(path.dirname(job.logPath), { recursive: true });
  await fs.appendFile(
    job.logPath,
    `${new Date().toISOString()} ${line}\n`,
    "utf8",
  );
}

function sleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}
