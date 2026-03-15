import fs from "node:fs/promises";
import path from "node:path";

import type { Logger } from "../util/logger.js";
import {
  createAutopilotExecutor,
  buildAutopilotSummary,
  type AutopilotConfig,
  type AutopilotRunInput,
} from "./autopilot.js";
import {
  createCodexExecutor,
  type CodexExecConfig,
  type CodexEvent,
} from "./codexExec.js";
import type { JobStore } from "./store.js";
import type { JobProgress, JobRecord, RunnerTarget } from "./types.js";

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
  createAutopilotJob(input: {
    competition: string;
    instruction: string;
    compute?: string;
    maxIterations?: number;
    dryRun?: boolean;
    target: RunnerTarget;
    runnerId: string;
    discordChannelId: string;
    dashboardBaseUrl: string;
  }): Promise<JobRecord>;
  startAutopilotJob(jobId: string, onUpdate: JobUpdateHandler): Promise<void>;
  cancelJob(jobId: string): Promise<JobRecord | null>;
  getJob(jobId?: string | null): Promise<JobRecord | null>;
  listJobs(limit?: number): Promise<JobRecord[]>;
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
  autopilotConfig: AutopilotConfig,
): JobService {
  const activeJobs = new Map<string, ActiveJob>();
  const codexExecutor = createCodexExecutor(codexConfig, logger);
  const autopilotExecutor = createAutopilotExecutor(autopilotConfig, logger);

  return {
    async createJob({ prompt, target, discordChannelId }) {
      let job = await store.create({
        tool: "codex",
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
      return await startTrackedJob(activeJobs, jobId, async (abortController) => {
        let job = await requireJob(store, jobId);

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

        const result = await codexExecutor.run(job, {
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
      }, logger, store, onUpdate);
    },
    async createAutopilotJob({
      competition,
      instruction,
      compute,
      maxIterations,
      dryRun,
      target,
      runnerId,
      discordChannelId,
      dashboardBaseUrl,
    }) {
      let job = await store.create({
        tool: "autopilot",
        prompt: instruction,
        target,
        status: "queued",
        runner_id: runnerId,
        discord_channel_id: discordChannelId,
        summary: `Queued kaggle-autopilot for ${competition}`,
        input: {
          competition,
          instruction,
          compute: compute ?? "local_gpu",
          maxIterations: maxIterations ?? 5,
          dryRun: dryRun ?? true,
        },
        dashboard_url: `${dashboardBaseUrl.replace(/\/$/, "")}/jobs/__JOB_ID__`,
      });

      job = await ensureLogPath(store, logDir, job);
      job = await store.update(job.id, {
        dashboard_url: `${dashboardBaseUrl.replace(/\/$/, "")}/jobs/${job.id}`,
      });
      return job;
    },
    async startAutopilotJob(jobId, onUpdate) {
      return await startTrackedJob(activeJobs, jobId, async (abortController) => {
        let job = await requireJob(store, jobId);
        const input = parseAutopilotInput(job.input);

        job = await ensureLogPath(store, logDir, job);
        job = await store.update(jobId, {
          status: "running",
          started_at: new Date().toISOString(),
          summary: `Launching kaggle-autopilot for ${input.competition}`,
        });
        await onUpdate(job);

        const { result, artifactRoot, progress } = await autopilotExecutor.run(
          job,
          input,
          {
            signal: abortController.signal,
            onPid: async (pid) => {
              const updated = await store.update(jobId, { pid });
              await onUpdate(updated);
            },
            onProgress: async (nextProgress, meta) => {
              const updated = await handleAutopilotProgress(
                store,
                jobId,
                nextProgress,
                meta.artifactRoot,
              );
              await onUpdate(updated);
            },
          },
        );

        const finalJob = await store.update(jobId, {
          status: result.status,
          finished_at: result.finished_at,
          summary: result.summary,
          artifact_root: artifactRoot,
          progress: progress ?? job.progress,
        });
        await onUpdate(finalJob);
      }, logger, store, onUpdate);
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
    async listJobs(limit) {
      return await store.list(limit);
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
          .slice(-20)
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

async function startTrackedJob(
  activeJobs: Map<string, ActiveJob>,
  jobId: string,
  execute: (abortController: AbortController) => Promise<void>,
  logger: Logger,
  store: JobStore,
  onUpdate: JobUpdateHandler,
): Promise<void> {
  const abortController = new AbortController();
  activeJobs.set(jobId, { abortController });

  try {
    await execute(abortController);
  } catch (error) {
    logger.error("Job execution failed", error);

    const failedJob = await store.get(jobId);
    if (failedJob) {
      const failed = await store.update(jobId, {
        status: "failed",
        finished_at: new Date().toISOString(),
        summary: error instanceof Error ? error.message : "job execution failed",
      });
      await onUpdate(failed);
    }
  } finally {
    activeJobs.delete(jobId);
  }
}

async function requireJob(store: JobStore, jobId: string): Promise<JobRecord> {
  const job = await store.get(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  return job;
}

async function ensureLogPath(
  store: JobStore,
  logDir: string,
  job: JobRecord,
): Promise<JobRecord> {
  if (job.log_path) {
    return job;
  }

  const extension = job.tool === "autopilot" ? "log" : "jsonl";
  const logPath = path.join(logDir, `${job.tool}-${job.id}.${extension}`);
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

async function handleAutopilotProgress(
  store: JobStore,
  jobId: string,
  progress: JobProgress,
  artifactRoot: string,
): Promise<JobRecord> {
  const summary = buildAutopilotSummary(progress) ?? "autopilot running";

  return await store.update(jobId, {
    artifact_root: artifactRoot,
    progress,
    summary,
  });
}

function parseAutopilotInput(
  input: Record<string, unknown> | undefined,
): AutopilotRunInput {
  return {
    competition:
      typeof input?.competition === "string"
        ? input.competition
        : "unknown-competition",
    instruction:
      typeof input?.instruction === "string" ? input.instruction : "",
    compute:
      typeof input?.compute === "string" ? input.compute : "local_gpu",
    maxIterations:
      typeof input?.maxIterations === "number" ? input.maxIterations : 5,
    dryRun:
      typeof input?.dryRun === "boolean" ? input.dryRun : true,
  };
}
