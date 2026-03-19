import fs from "node:fs/promises";

import { createCodexExecutor } from "../jobs/codexExec.js";
import { createLocalRunner } from "../jobs/runner.js";
import type { JobRecord, JobResult } from "../jobs/types.js";
import { createLogger } from "../util/logger.js";
import { loadRunnerConfig } from "./config.js";

type PollResponse = {
  job: JobRecord;
};

type RunnerEventResponse = {
  cancelRequested?: boolean;
};

async function main(): Promise<void> {
  const config = loadRunnerConfig();
  const logger = createLogger(config.logLevel);
  await validateRunnerStartup(config);
  const runner = createLocalRunner({ env: config.childEnv });
  const executor = createCodexExecutor(
    {
      codexBin: config.codexBin,
      gitBin: config.gitBin,
      workspaceRoot: config.workspaceRoot,
      sourceRepo: config.workspaceSourceRepo,
      fullAuto: config.codexFullAuto,
      sandbox: config.codexSandbox,
    },
    logger,
    runner,
  );

  let stopped = false;
  const stop = (): void => {
    stopped = true;
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  logger.info("Runner started", {
    runnerId: config.runnerId,
    apiBaseUrl: config.runnerApiBaseUrl,
    envFile: config.runnerEnvFile ?? null,
    nodeBin: config.nodeBin,
    codexBin: config.codexBin,
    gitBin: config.gitBin,
    workspaceRoot: config.workspaceRoot,
    sourceRepo: config.workspaceSourceRepo,
  });

  while (!stopped) {
    try {
      const job = await pollNextJob(config);
      if (!job) {
        continue;
      }

      logger.info("Claimed job", {
        jobId: job.id,
        runnerId: config.runnerId,
      });
      await executeJob(job, config, executor, logger);
    } catch (error) {
      logger.error("Runner loop failed", error);
      await delay(config.runnerRetryDelayMs);
    }
  }
}

async function validateRunnerStartup(
  config: ReturnType<typeof loadRunnerConfig>,
): Promise<void> {
  await fs.mkdir(config.workspaceRoot, { recursive: true });
}

async function pollNextJob(config: ReturnType<typeof loadRunnerConfig>): Promise<JobRecord | null> {
  const response = await apiFetch(config, "/api/runner/poll", {
    method: "POST",
    body: JSON.stringify({ runnerId: config.runnerId }),
  });

  if (response.status === 204) {
    return null;
  }

  if (!response.ok) {
    throw new Error(await readError(response, "runner poll failed"));
  }

  const payload = await response.json() as PollResponse;
  return payload.job ?? null;
}

async function executeJob(
  job: JobRecord,
  config: ReturnType<typeof loadRunnerConfig>,
  executor: ReturnType<typeof createCodexExecutor>,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  const localJob: JobRecord = {
    ...job,
    // The bot persists server-side log paths under Railway runtime paths like /app/logs.
    // The local runner should keep its own scratch logs and only stream events back.
    log_path: undefined,
  };
  const abortController = new AbortController();
  const heartbeatTimer = setInterval(() => {
    void sendHeartbeat(config, job.id, abortController, logger);
  }, config.runnerHeartbeatIntervalMs);

  try {
    const result = await executor.run(localJob, {
      signal: abortController.signal,
      onPid: async (pid) => {
        await apiFetch(config, `/api/runner/jobs/${job.id}/start`, {
          method: "POST",
          body: JSON.stringify({ pid }),
        });
      },
      onEvent: async (event, meta) => {
        const response = await apiFetch(config, `/api/runner/jobs/${job.id}/event`, {
          method: "POST",
          body: JSON.stringify({
            event,
            agentMessage: meta.agentMessage,
          }),
        });

        if (!response.ok) {
          throw new Error(await readError(response, "runner event upload failed"));
        }

        const payload = await response.json() as RunnerEventResponse;
        if (payload.cancelRequested) {
          abortController.abort();
        }
      },
    });

    await finishJob(config, job.id, result);
  } catch (error) {
    const result: JobResult = {
      status: abortController.signal.aborted ? "cancelled" : "failed",
      summary: error instanceof Error ? error.message : "runner execution failed",
      finished_at: new Date().toISOString(),
    };
    await finishJob(config, job.id, result);
    if (!abortController.signal.aborted) {
      logger.error("Runner job failed", {
        jobId: job.id,
        summary: result.summary,
      });
    }
  } finally {
    clearInterval(heartbeatTimer);
  }
}

async function sendHeartbeat(
  config: ReturnType<typeof loadRunnerConfig>,
  jobId: string,
  abortController: AbortController,
  logger: ReturnType<typeof createLogger>,
): Promise<void> {
  if (abortController.signal.aborted) {
    return;
  }

  try {
    const response = await apiFetch(config, `/api/runner/jobs/${jobId}/heartbeat`, {
      method: "POST",
    });
    if (!response.ok) {
      throw new Error(await readError(response, "runner heartbeat failed"));
    }

    const payload = await response.json() as RunnerEventResponse;
    if (payload.cancelRequested) {
      abortController.abort();
    }
  } catch (error) {
    logger.warn(`Heartbeat failed for job ${jobId}`, error);
  }
}

async function finishJob(
  config: ReturnType<typeof loadRunnerConfig>,
  jobId: string,
  result: JobResult,
): Promise<void> {
  const response = await apiFetch(config, `/api/runner/jobs/${jobId}/finish`, {
    method: "POST",
    body: JSON.stringify(result),
  });

  if (!response.ok) {
    throw new Error(await readError(response, "runner finish failed"));
  }
}

async function apiFetch(
  config: ReturnType<typeof loadRunnerConfig>,
  pathname: string,
  init: RequestInit,
): Promise<Response> {
  return await fetch(`${config.runnerApiBaseUrl}${pathname}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(config.runnerApiToken
        ? { authorization: `Bearer ${config.runnerApiToken}` }
        : {}),
      ...(init.headers ?? {}),
    },
  });
}

async function readError(
  response: Response,
  fallback: string,
): Promise<string> {
  const text = await response.text().catch(() => "");
  return text.trim() || fallback;
}

async function delay(ms: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
