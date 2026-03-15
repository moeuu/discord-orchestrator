import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { Client } from "discord.js";

import type { AppConfig } from "../config.js";
import { buildJobEmbed } from "../discord/ui.js";
import type { Logger } from "../util/logger.js";
import { buildAutopilotSummary } from "./autopilot.js";
import type { JobStore } from "./store.js";
import type { JobProgress, JobRecord, JobStatus } from "./types.js";
import type { createJobService } from "./service.js";

const execFileAsync = promisify(execFile);

type JobService = ReturnType<typeof createJobService>;
type UpdateJobMessage = (job: JobRecord) => Promise<void>;
type StreamJobLogs = (job: JobRecord) => Promise<void>;

type RemoteSession = {
  session_id: string;
  command: string;
  competition: string;
  instruction: string;
  log_path: string;
  artifact_root?: string;
  started_at?: string;
  finished_at?: string;
  status: JobStatus;
  progress?: JobProgress;
  exit_code?: number;
};

export function startManualAutopilotWatcher(
  client: Client,
  config: AppConfig,
  logger: Logger,
  store: JobStore,
  jobs: JobService,
  updateJobMessage: UpdateJobMessage,
  streamJobLogs: StreamJobLogs,
): { stop(): void } {
  if (!config.autopilotRemoteWatchEnabled) {
    return { stop() {} };
  }

  if (!config.autopilotRemoteWatchHost || !config.autopilotRemoteWatchChannelId) {
    logger.warn(
      "AUTOPILOT_REMOTE_WATCH_ENABLED is true but host/channel configuration is incomplete",
    );
    return { stop() {} };
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let polling = false;

  const schedule = (delayMs: number): void => {
    if (stopped) {
      return;
    }

    timer = setTimeout(() => {
      timer = null;
      void poll();
    }, delayMs);
  };

  const poll = async (): Promise<void> => {
    if (stopped || polling) {
      return;
    }

    polling = true;

    try {
      const sessions = await fetchRemoteSessions(config);
      for (const session of sessions) {
        await syncRemoteSession(session);
      }
    } catch (error) {
      logger.warn("Failed to poll remote autopilot sessions", error);
    } finally {
      polling = false;
      schedule(config.autopilotRemotePollIntervalMs);
    }
  };

  client.once("ready", () => {
    schedule(0);
  });

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearTimeout(timer);
      }
    },
  };

  async function syncRemoteSession(session: RemoteSession): Promise<void> {
    const summary =
      buildAutopilotSummary(session.progress ?? null) ??
      buildRemoteSessionSummary(session);
    const { job: observedJob } = await jobs.observeRemoteAutopilotSession({
      sessionId: session.session_id,
      competition: session.competition,
      instruction: session.instruction,
      command: session.command,
      runnerId:
        config.autopilotRemoteWatchRunnerId ?? config.autopilotRemoteWatchHost!,
      discordChannelId: config.autopilotRemoteWatchChannelId!,
      dashboardBaseUrl: config.dashboardBaseUrl,
      remoteLogPath: session.log_path,
      artifactRoot: session.artifact_root,
      status: session.status,
      startedAt: session.started_at,
      finishedAt: session.finished_at,
      summary,
      progress: session.progress,
    });

    let job = observedJob;
    if (!job.discord_message_id) {
      job = await createJobMessage(job);
    }

    job = await syncRemoteLog(job);
    await updateJobMessage(job);
  }

  async function createJobMessage(job: JobRecord): Promise<JobRecord> {
    const channel = await client.channels.fetch(job.discord_channel_id);
    if (!channel?.isTextBased() || !("send" in channel)) {
      throw new Error(`Channel is not text-based: ${job.discord_channel_id}`);
    }

    const message = await (
      channel as { send(payload: { embeds: ReturnType<typeof buildJobEmbed>[] }): Promise<{ id: string }> }
    ).send({
      embeds: [buildJobEmbed(job)],
    });

    return await store.update(job.id, {
      discord_message_id: message.id,
    });
  }

  async function syncRemoteLog(job: JobRecord): Promise<JobRecord> {
    if (!job.remote_log_path || !job.log_path) {
      return job;
    }

    const delta = await fetchRemoteLogDelta(
      config,
      job.remote_log_path,
      job.remote_log_offset ?? 0,
    );
    if (!delta.content) {
      return job;
    }

    await fs.mkdir(path.dirname(job.log_path), { recursive: true });
    await fs.appendFile(job.log_path, delta.content, "utf8");

    const updated = await store.update(job.id, {
      remote_log_offset: delta.next_offset,
    });
    await streamJobLogs(updated);
    return updated;
  }
}

async function fetchRemoteSessions(config: AppConfig): Promise<RemoteSession[]> {
  const payload = await runSshJson<{
    sessions?: RemoteSession[];
  }>(
    config.autopilotRemoteWatchHost!,
    REMOTE_SESSION_LIST_SCRIPT,
    [
      config.autopilotRemoteSessionDir,
      String(config.autopilotRemoteSessionLimit),
    ],
  );

  return Array.isArray(payload.sessions) ? payload.sessions : [];
}

async function fetchRemoteLogDelta(
  config: AppConfig,
  logPath: string,
  offset: number,
): Promise<{ content: string; next_offset: number }> {
  const payload = await runSshJson<{
    content?: string;
    next_offset?: number;
  }>(
    config.autopilotRemoteWatchHost!,
    REMOTE_LOG_DELTA_SCRIPT,
    [
      logPath,
      String(offset),
      String(config.autopilotRemoteLogChunkBytes),
    ],
  );

  return {
    content: typeof payload.content === "string" ? payload.content : "",
    next_offset:
      typeof payload.next_offset === "number" ? payload.next_offset : offset,
  };
}

async function runSshJson<T>(
  host: string,
  script: string,
  args: string[],
): Promise<T> {
  const { stdout } = await execFileAsync(
    "ssh",
    [host, "python3", "-c", script, ...args],
    { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
  );

  return JSON.parse(stdout) as T;
}

function buildRemoteSessionSummary(session: RemoteSession): string {
  const base = session.finished_at
    ? `Manual autopilot ${session.status}`
    : "Observed manual autopilot";
  const exitCode =
    typeof session.exit_code === "number" ? `exit=${session.exit_code}` : null;

  return [base, session.competition, exitCode]
    .filter((value): value is string => Boolean(value))
    .join(" | ");
}

const REMOTE_LOG_DELTA_SCRIPT = String.raw`
import json
import sys

path = sys.argv[1]
offset = int(sys.argv[2])
limit = int(sys.argv[3])

try:
    with open(path, "rb") as handle:
        handle.seek(offset)
        data = handle.read(limit)
        next_offset = handle.tell()
except FileNotFoundError:
    data = b""
    next_offset = offset

print(json.dumps({
    "content": data.decode("utf-8", "replace"),
    "next_offset": next_offset,
}))
`;

const REMOTE_SESSION_LIST_SCRIPT = String.raw`
import json
import os
import sys
from pathlib import Path


def read_json(path):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            value = json.load(handle)
            return value if isinstance(value, dict) else None
    except Exception:
        return None


def read_text(path):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            value = handle.read().strip()
            return value or None
    except Exception:
        return None


def summarize_markdown(value):
    if not value:
        return None
    normalized = value.replace("#", " ").replace(chr(96), " ").replace("*", " ")
    normalized = normalized.replace("_", " ").replace(">", " ").replace("-", " ")
    normalized = " ".join(normalized.split()).strip()
    if not normalized:
        return None
    return normalized[:157] + "..." if len(normalized) > 160 else normalized


def read_iterations(run_dir):
    iterations = []
    if not run_dir or not run_dir.exists():
        return iterations
    for child in sorted(run_dir.iterdir(), key=lambda value: value.name):
        if not child.is_dir() or not child.name.startswith("iter-"):
            continue
        try:
            index = int(child.name.split("-", 1)[1])
        except Exception:
            continue
        metrics = read_json(child / "metrics.json") or {}
        metric_name = None
        metric_value = None
        for key, entry in metrics.items():
            if isinstance(entry, (int, float, str)):
                metric_name = key
                metric_value = str(entry)
                break
            if isinstance(entry, dict):
                for nested_key, nested_value in entry.items():
                    if isinstance(nested_value, (int, float, str)):
                        metric_name = nested_key
                        metric_value = str(nested_value)
                        break
            if metric_value:
                break
        iterations.append({
            "index": index,
            "metric_name": metric_name,
            "metric_value": metric_value,
            "strategy": summarize_markdown(read_text(child / "diagnostics.md")),
        })
    return iterations


def latest_run_dir(runs_dir):
    if not runs_dir.exists():
        return None
    dirs = [child for child in runs_dir.iterdir() if child.is_dir()]
    if not dirs:
        return None
    dirs.sort(key=lambda value: value.stat().st_mtime, reverse=True)
    return dirs[0]


def read_progress(artifact_root):
    root = Path(artifact_root).expanduser()
    plan = read_json(root / "plan.json")
    run_dir = latest_run_dir(root / "runs")
    latest_agent_message = read_text((run_dir or root) / "agent" / "codex_last_message.txt")
    if not plan and not run_dir and not latest_agent_message:
        return None

    run_json = read_json(run_dir / "run.json") if run_dir else None
    run_state = read_json(run_dir / "run_state.json") if run_dir else None
    iterations = read_iterations(run_dir)
    latest_iteration = iterations[-1] if iterations else None

    phase = "planning"
    if isinstance(run_state, dict) and run_state.get("submit_ok") is True:
        phase = "completed"
    elif isinstance(run_state, dict) and isinstance(run_state.get("last_action"), str) and "submit" in run_state.get("last_action").lower():
        phase = "submitting"
    elif latest_iteration:
        phase = "iterating"
    elif isinstance(run_json, dict) and isinstance(run_json.get("status"), str):
        phase = run_json.get("status")

    last_error = None
    if isinstance(run_state, dict):
        kind = run_state.get("last_error_kind")
        reason = run_state.get("last_reason")
        if isinstance(kind, str) and isinstance(reason, str):
            last_error = f"{kind}: {reason}"
        elif isinstance(kind, str):
            last_error = kind
        elif isinstance(reason, str):
            last_error = reason

    submission_status = None
    if isinstance(run_state, dict):
        action = run_state.get("last_action")
        if isinstance(action, str):
            submission_status = action
        elif run_state.get("submit_ok") is True:
            submission_status = "submitted"
        elif run_state.get("submit_attempted") is True:
            submission_status = "attempted"

    max_iterations = None
    if isinstance(plan, dict):
        for key in ("max_iterations", "maxIterations", "iteration_budget", "iterations"):
            candidate = plan.get(key)
            if isinstance(candidate, int):
                max_iterations = candidate
                break

    best_metric_name = None
    best_metric = None
    if latest_iteration:
        best_metric_name = latest_iteration.get("metric_name")
        best_metric = latest_iteration.get("metric_value")

    strategy_summary = None
    if latest_iteration and latest_iteration.get("strategy"):
        strategy_summary = latest_iteration.get("strategy")
    elif isinstance(plan, dict):
        parts = []
        for key in ("target_metric", "metric", "score_metric"):
            candidate = plan.get(key)
            if isinstance(candidate, str) and candidate.strip():
                parts.append(f"target metric={candidate}")
                break
        for key in ("cv_folds", "folds"):
            candidate = plan.get(key)
            if isinstance(candidate, int):
                parts.append(f"cv={candidate}")
                break
        internet = plan.get("internet")
        if isinstance(internet, str) and internet.strip():
            parts.append(f"internet={internet}")
        strategy_summary = ", ".join(parts) or None
    elif latest_agent_message:
        strategy_summary = latest_agent_message

    run_id = None
    if isinstance(run_json, dict) and isinstance(run_json.get("run_id"), str):
        run_id = run_json.get("run_id")
    elif run_dir:
        run_id = run_dir.name

    return {
        "phase": phase,
        "competition_slug": root.name,
        "run_id": run_id,
        "current_iter": latest_iteration.get("index") if latest_iteration else None,
        "max_iterations": max_iterations,
        "strategy_summary": strategy_summary,
        "latest_agent_message": latest_agent_message,
        "best_metric": best_metric,
        "best_metric_name": best_metric_name,
        "submission_status": submission_status,
        "last_error": last_error,
        "updated_at": None,
        "plan": plan,
        "iterations": iterations,
    }


root = Path(sys.argv[1]).expanduser()
limit = int(sys.argv[2])
sessions = []

if root.exists():
    manifests = []
    for child in root.iterdir():
        manifest = child / "session.json"
        if manifest.exists():
            manifests.append(manifest)

    manifests.sort(key=lambda value: value.stat().st_mtime, reverse=True)

    for manifest in manifests[:limit]:
        session = read_json(manifest)
        if not session:
            continue
        artifact_root = session.get("artifact_root")
        progress = read_progress(artifact_root) if isinstance(artifact_root, str) else None
        sessions.append({
            "session_id": session.get("session_id") or manifest.parent.name,
            "command": session.get("command") or "",
            "competition": session.get("competition") or "unknown-competition",
            "instruction": session.get("instruction") or "",
            "log_path": session.get("log_path") or str(manifest.parent / "console.log"),
            "artifact_root": artifact_root if isinstance(artifact_root, str) else None,
            "started_at": session.get("started_at"),
            "finished_at": session.get("finished_at"),
            "status": session.get("status") or "running",
            "exit_code": session.get("exit_code"),
            "progress": progress,
        })

print(json.dumps({"sessions": sessions}))
`;
