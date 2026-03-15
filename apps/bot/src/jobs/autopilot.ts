import fs from "node:fs/promises";
import path from "node:path";

import type { Logger } from "../util/logger.js";
import { createLocalRunner, type Runner } from "./runner.js";
import type { JobProgress, JobRecord, JobResult } from "./types.js";

export type AutopilotConfig = {
  autopilotBin: string;
  workdir: string;
  artifactsDir?: string;
  pollIntervalMs?: number;
};

export type AutopilotRunInput = {
  competition: string;
  instruction: string;
  compute?: string;
  maxIterations?: number;
  dryRun?: boolean;
};

type AutopilotRunOptions = {
  signal?: AbortSignal;
  onPid?: (pid: number) => Promise<void> | void;
  onProgress?: (
    progress: JobProgress,
    meta: { artifactRoot: string },
  ) => Promise<void> | void;
};

type AutopilotExecutor = {
  run(
    job: JobRecord,
    input: AutopilotRunInput,
    options?: AutopilotRunOptions,
  ): Promise<{
    result: JobResult;
    artifactRoot: string;
    progress: JobProgress | null;
  }>;
};

export function createAutopilotExecutor(
  config: AutopilotConfig,
  logger: Logger,
  runner: Runner = createLocalRunner(),
): AutopilotExecutor {
  return {
    async run(job, input, options = {}) {
      const artifactRoot = resolveArtifactRoot(
        config.artifactsDir ?? path.join(config.workdir, "artifacts"),
        input.competition,
      );
      await fs.mkdir(artifactRoot, { recursive: true });

      return await new Promise((resolve) => {
        const args = buildAutopilotArgs(input);
        const child = runner.spawn(config.autopilotBin, args, {
          cwd: config.workdir,
          stdio: ["ignore", "pipe", "pipe"],
        });

        let settled = false;
        let stdoutBuffer = "";
        let stderrBuffer = "";
        let lastProgress: JobProgress | null = null;
        let timer: ReturnType<typeof setInterval> | null = null;
        let logQueue = Promise.resolve();

        const resolveOnce = (value: {
          result: JobResult;
          artifactRoot: string;
          progress: JobProgress | null;
        }): void => {
          if (settled) {
            return;
          }

          settled = true;
          if (timer) {
            clearInterval(timer);
          }
          resolve(value);
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

        timer = setInterval(() => {
          logQueue = logQueue
            .then(async () => {
              const progress = await readAutopilotProgress(artifactRoot);
              if (!progress || isSameProgress(progress, lastProgress)) {
                return;
              }

              lastProgress = progress;
              await options.onProgress?.(progress, { artifactRoot });
            })
            .catch((error) => {
              logger.warn(`Failed to refresh autopilot progress for ${job.id}`, error);
            });
        }, config.pollIntervalMs ?? 5000);

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
          resolveOnce({
            result: {
              status: options.signal?.aborted ? "cancelled" : "failed",
              summary: error.message,
              finished_at: new Date().toISOString(),
            },
            artifactRoot,
            progress: lastProgress,
          });
        });

        child.once("close", (exitCode, signal) => {
          void logQueue.finally(async () => {
            const finalProgress = (await readAutopilotProgress(artifactRoot)) ?? lastProgress;
            const summary = buildAutopilotSummary(finalProgress);

            if (options.signal) {
              options.signal.removeEventListener("abort", handleAbort);
            }

            if (options.signal?.aborted || signal === "SIGTERM") {
              resolveOnce({
                result: {
                  status: "cancelled",
                  summary: summary ?? "Autopilot cancelled",
                  finished_at: new Date().toISOString(),
                },
                artifactRoot,
                progress: finalProgress,
              });
              return;
            }

            if (exitCode === 0) {
              resolveOnce({
                result: {
                  status: "succeeded",
                  summary: summary ?? "kaggle-autopilot completed",
                  finished_at: new Date().toISOString(),
                },
                artifactRoot,
                progress: finalProgress,
              });
              return;
            }

            resolveOnce({
              result: {
                status: "failed",
                summary:
                  summary ??
                  stderrBuffer.trim() ??
                  stdoutBuffer.trim() ??
                  "kaggle-autopilot failed",
                finished_at: new Date().toISOString(),
              },
              artifactRoot,
              progress: finalProgress,
            });
          });
        });
      });
    },
  };
}

export function buildAutopilotArgs(input: AutopilotRunInput): string[] {
  const args = ["run", "kagglebot", "autopilot", input.competition];

  if (input.compute) {
    args.push("--compute", input.compute);
  }

  if (typeof input.maxIterations === "number") {
    args.push("--max-iterations", String(input.maxIterations));
  }

  if (input.dryRun) {
    args.push("--dry-run");
  }

  if (input.instruction.trim()) {
    args.push("--goal", input.instruction.trim());
  }

  return args;
}

export function resolveArtifactRoot(
  artifactsDir: string,
  competition: string,
): string {
  return path.join(artifactsDir, slugifyCompetition(competition));
}

export async function readAutopilotProgress(
  artifactRoot: string,
): Promise<JobProgress | null> {
  const plan = await readJson(path.join(artifactRoot, "plan.json"));
  const latestRunDir = await findLatestRunDir(path.join(artifactRoot, "runs"));
  const latestAgentMessage = await readText(
    path.join(latestRunDir ?? artifactRoot, "agent", "codex_last_message.txt"),
  );

  if (!plan && !latestRunDir && !latestAgentMessage) {
    return null;
  }

  const runJson = latestRunDir
    ? await readJson(path.join(latestRunDir, "run.json"))
    : null;
  const runState = latestRunDir
    ? await readJson(path.join(latestRunDir, "run_state.json"))
    : null;
  const iterations = latestRunDir
    ? await readIterations(latestRunDir)
    : [];

  const currentIter =
    iterations.length > 0 ? iterations[iterations.length - 1].index : undefined;
  const latestIteration =
    iterations.length > 0 ? iterations[iterations.length - 1] : undefined;
  const submissionStatus = deriveSubmissionStatus(runState);
  const lastError = deriveLastError(runState);
  const bestMetric = findBestMetric(iterations);
  const maxIterations = findNumber(plan, [
    "max_iterations",
    "maxIterations",
    "iteration_budget",
  ]);

  const progress: JobProgress = {
    phase: derivePhase(runJson, runState, currentIter),
    competition_slug: path.basename(artifactRoot),
    run_id:
      typeof runJson?.run_id === "string"
        ? runJson.run_id
        : latestRunDir
          ? path.basename(latestRunDir)
          : undefined,
    current_iter: currentIter,
    max_iterations: maxIterations,
    strategy_summary:
      latestIteration?.strategy ??
      summarizePlan(plan) ??
      latestAgentMessage ??
      undefined,
    latest_agent_message: latestAgentMessage ?? undefined,
    best_metric: bestMetric?.value,
    best_metric_name: bestMetric?.name,
    submission_status: submissionStatus,
    last_error: lastError,
    updated_at: new Date().toISOString(),
    plan: plan && typeof plan === "object" ? plan : undefined,
    iterations,
  };

  return progress;
}

export function buildAutopilotSummary(progress: JobProgress | null): string | null {
  if (!progress) {
    return null;
  }

  const parts = [
    progress.phase ? `phase=${progress.phase}` : null,
    typeof progress.current_iter === "number"
      ? `iter=${progress.current_iter}`
      : null,
    progress.best_metric_name && progress.best_metric
      ? `${progress.best_metric_name}=${progress.best_metric}`
      : progress.best_metric
        ? `best=${progress.best_metric}`
        : null,
    progress.submission_status ? `submit=${progress.submission_status}` : null,
    progress.strategy_summary ? progress.strategy_summary : null,
  ].filter((value): value is string => Boolean(value));

  return parts.join(" | ") || null;
}

async function appendLog(logPath: string | undefined, text: string): Promise<void> {
  if (!logPath) {
    return;
  }

  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.appendFile(logPath, text, "utf8");
}

async function findLatestRunDir(runsDir: string): Promise<string | null> {
  try {
    const entries = await fs.readdir(runsDir, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory());
    if (directories.length === 0) {
      return null;
    }

    const stats = await Promise.all(
      directories.map(async (entry) => {
        const fullPath = path.join(runsDir, entry.name);
        const stat = await fs.stat(fullPath);
        return { fullPath, mtimeMs: stat.mtimeMs };
      }),
    );

    stats.sort((left, right) => right.mtimeMs - left.mtimeMs);
    return stats[0]?.fullPath ?? null;
  } catch {
    return null;
  }
}

async function readIterations(
  latestRunDir: string,
): Promise<NonNullable<JobProgress["iterations"]>> {
  try {
    const entries = await fs.readdir(latestRunDir, { withFileTypes: true });
    const iterationDirs = entries
      .filter((entry) => entry.isDirectory() && /^iter-\d+$/.test(entry.name))
      .map((entry) => entry.name)
      .sort((left, right) => Number(left.slice(5)) - Number(right.slice(5)));

    const iterations = await Promise.all(
      iterationDirs.map(async (dirName) => {
        const index = Number(dirName.slice(5));
        const metrics = await readJson(path.join(latestRunDir, dirName, "metrics.json"));
        const diagnostics = await readText(
          path.join(latestRunDir, dirName, "diagnostics.md"),
        );
        const metric = extractMetric(metrics);

        return {
          index,
          metric_name: metric?.name,
          metric_value: metric?.value,
          strategy: summarizeMarkdown(diagnostics) ?? undefined,
        };
      }),
    );

    return iterations;
  } catch {
    return [];
  }
}

function derivePhase(
  runJson: Record<string, unknown> | null,
  runState: Record<string, unknown> | null,
  currentIter: number | undefined,
): string {
  if (runState?.submit_ok === true) {
    return "completed";
  }

  if (typeof runState?.last_action === "string") {
    const action = runState.last_action.toLowerCase();
    if (action.includes("submit")) {
      return "submitting";
    }
  }

  if (typeof currentIter === "number" && currentIter > 0) {
    return "iterating";
  }

  if (typeof runJson?.status === "string") {
    return runJson.status;
  }

  return "planning";
}

function deriveSubmissionStatus(runState: Record<string, unknown> | null): string | undefined {
  if (!runState) {
    return undefined;
  }

  if (typeof runState.last_action === "string") {
    return runState.last_action;
  }

  if (runState.submit_ok === true) {
    return "submitted";
  }

  if (runState.submit_attempted === true) {
    return "attempted";
  }

  return undefined;
}

function deriveLastError(runState: Record<string, unknown> | null): string | undefined {
  if (!runState) {
    return undefined;
  }

  const kind =
    typeof runState.last_error_kind === "string" ? runState.last_error_kind : null;
  const reason =
    typeof runState.last_reason === "string" ? runState.last_reason : null;

  if (kind && reason) {
    return `${kind}: ${reason}`;
  }

  return kind ?? reason ?? undefined;
}

function findBestMetric(
  iterations: NonNullable<JobProgress["iterations"]>,
): { name?: string; value?: string } | null {
  const withMetric = iterations.filter((iteration) => iteration.metric_value);
  if (withMetric.length === 0) {
    return null;
  }

  const latest = withMetric[withMetric.length - 1];
  return {
    name: latest.metric_name,
    value: latest.metric_value,
  };
}

function extractMetric(
  value: unknown,
): { name?: string; value?: string } | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "number" || typeof entry === "string") {
      return {
        name: key,
        value: String(entry),
      };
    }

    if (entry && typeof entry === "object") {
      const nested = extractMetric(entry);
      if (nested) {
        return nested.name
          ? nested
          : {
              name: key,
              value: nested.value,
            };
      }
    }
  }

  return null;
}

function summarizePlan(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const lines: string[] = [];
  const metric = findString(value, ["target_metric", "metric", "score_metric"]);
  const folds = findNumber(value, ["cv_folds", "folds"]);
  const internet = findString(value, ["internet"]);

  if (metric) {
    lines.push(`target metric=${metric}`);
  }
  if (typeof folds === "number") {
    lines.push(`cv=${folds}`);
  }
  if (internet) {
    lines.push(`internet=${internet}`);
  }

  return lines.join(", ") || null;
}

function summarizeMarkdown(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value
    .replace(/^#+\s+/gm, "")
    .replace(/[`*_>-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return null;
  }

  return normalized.length <= 160
    ? normalized
    : `${normalized.slice(0, 157)}...`;
}

function isSameProgress(left: JobProgress | null, right: JobProgress | null): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function slugifyCompetition(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+\//, "")
    .replace(/^c\//, "")
    .replace(/\/+$/, "")
    .split("/")
    .filter(Boolean)
    .pop()
    ?.replace(/[^a-z0-9-]+/g, "-")
    ?? "competition";
}

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function readText(filePath: string): Promise<string | null> {
  try {
    const value = await fs.readFile(filePath, "utf8");
    return value.trim() || null;
  } catch {
    return null;
  }
}

function findNumber(
  value: unknown,
  keys: string[],
): number | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  for (const key of keys) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "number") {
      return candidate;
    }
  }

  return undefined;
}

function findString(
  value: unknown,
  keys: string[],
): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  for (const key of keys) {
    const candidate = (value as Record<string, unknown>)[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate;
    }
  }

  return undefined;
}
