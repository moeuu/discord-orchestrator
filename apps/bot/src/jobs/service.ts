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
  buildCodexProgress,
  type CodexExecutor,
  createCodexExecutor,
  renderCodexLogPreview,
  type CodexExecConfig,
  type CodexEvent,
} from "./codexExec.js";
import { createBridgeCodexExecutor } from "./bridgeCodexExec.js";
import {
  createShellExecutor,
  type ShellExecConfig,
} from "./shellExec.js";
import type { CodexTarget } from "../targets.js";
import type { JobStore } from "./store.js";
import type {
  JobProgress,
  JobRecord,
  JobStatus,
  RunnerTarget,
} from "./types.js";

type JobUpdateHandler = (job: JobRecord) => Promise<void>;

type JobLogInfo = {
  job: JobRecord | null;
  preview: string | null;
};

type JobService = {
  createJob(input: {
    prompt: string;
    target: RunnerTarget;
    runnerId?: string;
    discordChannelId: string;
    externalId?: string;
  }): Promise<JobRecord>;
  startJob(jobId: string, onUpdate: JobUpdateHandler): Promise<void>;
  createShellJob(input: {
    command: string;
    discordChannelId: string;
  }): Promise<JobRecord>;
  startShellJob(jobId: string, onUpdate: JobUpdateHandler): Promise<void>;
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
  observeRemoteAutopilotSession(input: {
    sessionId: string;
    competition: string;
    instruction: string;
    command: string;
    runnerId: string;
    discordChannelId: string;
    dashboardBaseUrl: string;
    remoteLogPath: string;
    artifactRoot?: string;
    status: JobStatus;
    startedAt?: string;
    finishedAt?: string;
    summary?: string;
    progress?: JobProgress;
  }): Promise<{ job: JobRecord; created: boolean }>;
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
  codexConfig: CodexExecConfig & {
    bridgeAuthToken?: string;
    targets?: CodexTarget[];
  },
  autopilotConfig: AutopilotConfig,
  shellConfig: ShellExecConfig,
): JobService {
  const activeJobs = new Map<string, ActiveJob>();
  const codexExecutor = createCodexExecutor(codexConfig, logger);
  const bridgeCodexExecutor =
    codexConfig.targets && codexConfig.targets.length > 0
      ? createBridgeCodexExecutor(
          {
            ...codexConfig,
            targets: codexConfig.targets,
          },
          logger,
        )
      : null;
  const autopilotExecutor = createAutopilotExecutor(autopilotConfig, logger);
  const shellExecutor = createShellExecutor(shellConfig, logger);

  return {
    async createJob({ prompt, target, runnerId, discordChannelId, externalId }) {
      let job = await store.create({
        tool: "codex",
        prompt,
        target,
        runner_id: runnerId,
        status: "queued",
        discord_channel_id: discordChannelId,
        external_id: externalId,
        summary: "Queued codex exec",
      });

      job = await ensureLogPath(store, logDir, job);
      return job;
    },
    async startJob(jobId, onUpdate) {
      return await startTrackedJob(activeJobs, jobId, async (abortController) => {
        let job = await requireJob(store, jobId);

        const executor =
          job.target === "local"
            ? codexExecutor
            : resolveRemoteCodexExecutor(job, bridgeCodexExecutor);

        if (!executor) {
          throw new Error(`Unsupported codex target: ${job.target}`);
        }

        job = await ensureLogPath(store, logDir, job);
        job = await store.update(jobId, {
          status: "running",
          started_at: new Date().toISOString(),
          summary:
            job.target === "local"
              ? "Preparing workspace clone"
              : `Dispatching remote codex job to ${job.runner_id ?? job.target}`,
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
      }, logger, store, onUpdate);
    },
    async createShellJob({ command, discordChannelId }) {
      let job = await store.create({
        tool: "shell",
        prompt: command,
        target: "local",
        status: "queued",
        discord_channel_id: discordChannelId,
        input: {
          command,
        },
        summary: "Queued shell command",
      });

      job = await ensureLogPath(store, logDir, job);
      return job;
    },
    async startShellJob(jobId, onUpdate) {
      return await startTrackedJob(activeJobs, jobId, async (abortController) => {
        let job = await requireJob(store, jobId);
        const command =
          typeof job.input?.command === "string" ? job.input.command : job.prompt;

        job = await ensureLogPath(store, logDir, job);
        job = await store.update(jobId, {
          status: "running",
          started_at: new Date().toISOString(),
          summary: `Running shell command: ${command}`,
        });
        await onUpdate(job);

        const result = await shellExecutor.run(
          job,
          { command },
          {
            signal: abortController.signal,
            onPid: async (pid) => {
              const updated = await store.update(jobId, { pid });
              await onUpdate(updated);
            },
          },
        );

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
    async observeRemoteAutopilotSession({
      sessionId,
      competition,
      instruction,
      command,
      runnerId,
      discordChannelId,
      dashboardBaseUrl,
      remoteLogPath,
      artifactRoot,
      status,
      startedAt,
      finishedAt,
      summary,
      progress,
    }) {
      const existing = await findJobByExternalId(store, sessionId);
      const nextSummary =
        summary ??
        buildAutopilotSummary(progress ?? null) ??
        `Observed autopilot for ${competition}`;

      if (existing) {
        let job = await store.update(existing.id, {
          prompt: instruction || existing.prompt,
          status,
          runner_id: runnerId,
          summary: nextSummary,
          started_at: startedAt ?? existing.started_at,
          finished_at: finishedAt ?? existing.finished_at,
          remote_log_path: remoteLogPath,
          artifact_root: artifactRoot ?? existing.artifact_root,
          progress: progress ?? existing.progress,
          input: {
            ...existing.input,
            competition,
            instruction,
            command,
            manualSessionId: sessionId,
            observed: true,
          },
        });
        job = await ensureLogPath(store, logDir, job);
        return { job, created: false };
      }

      let job = await store.create({
        tool: "autopilot",
        prompt: instruction || command,
        target: "ssh",
        status,
        runner_id: runnerId,
        discord_channel_id: discordChannelId,
        external_id: sessionId,
        remote_log_path: remoteLogPath,
        remote_log_offset: 0,
        summary: nextSummary,
        started_at: startedAt,
        finished_at: finishedAt,
        artifact_root: artifactRoot,
        progress,
        input: {
          competition,
          instruction,
          command,
          manualSessionId: sessionId,
          observed: true,
        },
        dashboard_url: `${dashboardBaseUrl.replace(/\/$/, "")}/jobs/__JOB_ID__`,
      });

      job = await ensureLogPath(store, logDir, job);
      job = await store.update(job.id, {
        dashboard_url: `${dashboardBaseUrl.replace(/\/$/, "")}/jobs/${job.id}`,
      });
      return { job, created: true };
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
        const preview = job.tool === "codex"
          ? renderCodexLogPreview(contents, 8)
          : contents
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

function resolveRemoteCodexExecutor(
  job: JobRecord,
  bridgeCodexExecutor: CodexExecutor | null,
): CodexExecutor | null {
  if (job.target === "ssh" && bridgeCodexExecutor) {
    return bridgeCodexExecutor;
  }

  return null;
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

  const extension = job.tool === "codex" ? "jsonl" : "log";
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
  const job = await store.get(jobId);
  if (!job) {
    return null;
  }

  const progress = buildCodexProgress(job.progress, event, agentMessage);
  const patch: Partial<JobRecord> = {
    progress,
  };

  if (progress.activity) {
    patch.summary = progress.activity;
  } else if (agentMessage) {
    patch.summary = agentMessage;
  }

  if (
    typeof event.type === "string" &&
    event.type === "thread.started" &&
    typeof event.thread_id === "string"
  ) {
    patch.external_id = event.thread_id;
  }

  if (typeof event.type === "string" && event.type === "task_complete") {
    patch.summary = agentMessage ?? patch.summary;
  }

  if (Object.keys(patch).length === 0) {
    return null;
  }

  if (
    patch.summary === job.summary &&
    patch.external_id === job.external_id &&
    JSON.stringify(patch.progress ?? null) === JSON.stringify(job.progress ?? null)
  ) {
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

async function findJobByExternalId(
  store: JobStore,
  externalId: string,
): Promise<JobRecord | null> {
  const jobs = await store.list();
  return jobs.find((job) => job.external_id === externalId) ?? null;
}
