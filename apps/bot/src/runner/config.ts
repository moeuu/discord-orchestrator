import path from "node:path";
import { execFileSync } from "node:child_process";

import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

function emptyToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

const runnerConfigSchema = z.object({
  RUNNER_ID: z.string().min(1).default("macbook"),
  RUNNER_API_BASE_URL: z.string().url(),
  RUNNER_API_TOKEN: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional(),
  ),
  RUNNER_HEARTBEAT_INTERVAL_MS: z.coerce.number().int().positive().default(3000),
  RUNNER_RETRY_DELAY_MS: z.coerce.number().int().positive().default(3000),
  CODEX_BIN: z.string().min(1).default("codex"),
  WORKSPACE_ROOT: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional(),
  ),
  WORKSPACE_SOURCE_REPO: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional(),
  ),
  CODEX_FULL_AUTO: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  CODEX_SANDBOX: z.preprocess(
    emptyToUndefined,
    z
      .enum(["read-only", "workspace-write", "danger-full-access"])
      .optional(),
  ),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type RunnerConfig = {
  runnerId: string;
  runnerApiBaseUrl: string;
  runnerApiToken?: string;
  runnerHeartbeatIntervalMs: number;
  runnerRetryDelayMs: number;
  codexBin: string;
  workspaceRoot: string;
  workspaceSourceRepo: string;
  codexFullAuto: boolean;
  codexSandbox?: "read-only" | "workspace-write" | "danger-full-access";
  logLevel: "debug" | "info" | "warn" | "error";
};

export function loadRunnerConfig(): RunnerConfig {
  const parsed = runnerConfigSchema.parse(process.env);
  const repoRoot = detectGitRepoRoot(process.cwd());

  return {
    runnerId: parsed.RUNNER_ID,
    runnerApiBaseUrl: parsed.RUNNER_API_BASE_URL.replace(/\/$/, ""),
    runnerApiToken: parsed.RUNNER_API_TOKEN,
    runnerHeartbeatIntervalMs: parsed.RUNNER_HEARTBEAT_INTERVAL_MS,
    runnerRetryDelayMs: parsed.RUNNER_RETRY_DELAY_MS,
    codexBin: parsed.CODEX_BIN,
    workspaceRoot: parsed.WORKSPACE_ROOT
      ? resolveLocalPath(process.cwd(), parsed.WORKSPACE_ROOT)
      : resolveLocalPath(process.cwd(), "../../data/workspaces"),
    workspaceSourceRepo: resolveRepoSource(
      process.cwd(),
      parsed.WORKSPACE_SOURCE_REPO ?? repoRoot,
    ),
    codexFullAuto: parsed.CODEX_FULL_AUTO,
    codexSandbox: parsed.CODEX_SANDBOX,
    logLevel: parsed.LOG_LEVEL,
  };
}

function detectGitRepoRoot(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd,
      encoding: "utf8",
    }).trim();
  } catch {
    return "../..";
  }
}

function resolveLocalPath(cwd: string, value: string): string {
  return path.resolve(cwd, value);
}

function resolveRepoSource(cwd: string, value: string): string {
  return isRemoteRepoSpecifier(value)
    ? value
    : resolveLocalPath(cwd, value);
}

function isRemoteRepoSpecifier(value: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:\/\/|git@|ssh:\/\/)/i.test(value);
}
