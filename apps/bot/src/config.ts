import path from "node:path";
import { execFileSync } from "node:child_process";

import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

function emptyToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

const configSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APP_ID: z.string().min(1).optional(),
  DISCORD_APPLICATION_ID: z.string().min(1).optional(),
  DISCORD_GUILD_ID: z.string().min(1),
  BOT_RUNNER_ID: z.string().min(1).default("macbook"),
  BOT_RUNNER_LABEL: z.string().min(1).default("MacBook"),
  RUNNER_API_TOKEN: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional(),
  ),
  RUNNER_LONG_POLL_TIMEOUT_MS: z.coerce.number().int().positive().default(25000),
  CODEX_BIN: z.string().min(1).default("codex"),
  STORAGE_ROOT: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional(),
  ),
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
  JOB_DATA_DIR: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional(),
  ),
  LOG_DIR: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional(),
  ),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  CHAT_COMMANDS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  CHAT_COMMANDS_REQUIRE_MENTION: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  CHAT_COMMANDS_ALLOWED_USER_IDS: z.preprocess(
    emptyToUndefined,
    z.string().optional(),
  ),
  CHAT_COMMANDS_WORKDIR: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional(),
  ),
  CHAT_LLM_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  CHAT_LLM_MODEL: z.string().min(1).default("gpt-5.4"),
  LOG_STREAM_USE_THREADS: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  PORT: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
  DASHBOARD_HOST: z.string().min(1).default("0.0.0.0"),
  DASHBOARD_PORT: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
  DASHBOARD_BASE_URL: z
    .preprocess(emptyToUndefined, z.string().url().optional()),
  RAILWAY_PUBLIC_DOMAIN: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional(),
  ),
  AUTOPILOT_BIN: z.string().min(1).default("uv"),
  AUTOPILOT_WORKDIR: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional(),
  ),
  AUTOPILOT_ARTIFACTS_DIR: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional(),
  ),
  AUTOPILOT_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(5000),
});

export type AppConfig = {
  discordToken: string;
  discordApplicationId: string;
  discordGuildId: string;
  botRunnerId: string;
  botRunnerLabel: string;
  runnerApiToken?: string;
  runnerLongPollTimeoutMs: number;
  codexBin: string;
  workspaceRoot: string;
  workspaceSourceRepo: string;
  storageRoot?: string;
  codexFullAuto: boolean;
  codexSandbox?: "read-only" | "workspace-write" | "danger-full-access";
  jobDataDir: string;
  logDir: string;
  logLevel: "debug" | "info" | "warn" | "error";
  chatCommandsEnabled: boolean;
  chatCommandsRequireMention: boolean;
  chatCommandsAllowedUserIds: string[];
  chatCommandsWorkdir: string;
  chatLlmEnabled: boolean;
  chatLlmModel: string;
  logStreamUseThreads: boolean;
  dashboardHost: string;
  dashboardPort: number;
  dashboardBaseUrl: string;
  autopilotBin: string;
  autopilotWorkdir?: string;
  autopilotArtifactsDir?: string;
  autopilotPollIntervalMs: number;
};

export function loadConfig(): AppConfig {
  const parsed = configSchema.parse(process.env);
  const discordApplicationId =
    parsed.DISCORD_APP_ID ?? parsed.DISCORD_APPLICATION_ID;
  const repoRoot = detectGitRepoRoot(process.cwd());
  const storageRoot = parsed.STORAGE_ROOT
    ? resolveLocalPath(process.cwd(), parsed.STORAGE_ROOT)
    : undefined;
  const workspaceSourceRepo = resolveRepoSource(
    process.cwd(),
    parsed.WORKSPACE_SOURCE_REPO ?? repoRoot,
  );
  const dashboardPort = parsed.DASHBOARD_PORT ?? parsed.PORT ?? 8787;

  if (!discordApplicationId) {
    throw new Error("DISCORD_APP_ID is required");
  }

  return {
    discordToken: parsed.DISCORD_TOKEN,
    discordApplicationId,
    discordGuildId: parsed.DISCORD_GUILD_ID,
    botRunnerId: parsed.BOT_RUNNER_ID,
    botRunnerLabel: parsed.BOT_RUNNER_LABEL,
    runnerApiToken: parsed.RUNNER_API_TOKEN,
    runnerLongPollTimeoutMs: parsed.RUNNER_LONG_POLL_TIMEOUT_MS,
    codexBin: parsed.CODEX_BIN,
    storageRoot,
    workspaceRoot: resolveStoragePath(
      process.cwd(),
      parsed.WORKSPACE_ROOT,
      storageRoot,
      "workspaces",
      "../../data/workspaces",
    ),
    workspaceSourceRepo,
    codexFullAuto: parsed.CODEX_FULL_AUTO,
    codexSandbox: parsed.CODEX_SANDBOX,
    jobDataDir: resolveStoragePath(
      process.cwd(),
      parsed.JOB_DATA_DIR,
      storageRoot,
      "data",
      "../../data",
    ),
    logDir: resolveStoragePath(
      process.cwd(),
      parsed.LOG_DIR,
      storageRoot,
      "logs",
      "../../logs",
    ),
    logLevel: parsed.LOG_LEVEL,
    chatCommandsEnabled: parsed.CHAT_COMMANDS_ENABLED,
    chatCommandsRequireMention: parsed.CHAT_COMMANDS_REQUIRE_MENTION,
    chatCommandsAllowedUserIds: splitList(parsed.CHAT_COMMANDS_ALLOWED_USER_IDS),
    chatCommandsWorkdir: resolveLocalPath(
      process.cwd(),
      parsed.CHAT_COMMANDS_WORKDIR ?? repoRoot,
    ),
    chatLlmEnabled: parsed.CHAT_LLM_ENABLED,
    chatLlmModel: parsed.CHAT_LLM_MODEL,
    logStreamUseThreads: parsed.LOG_STREAM_USE_THREADS,
    dashboardHost: parsed.DASHBOARD_HOST,
    dashboardPort,
    dashboardBaseUrl:
      parsed.DASHBOARD_BASE_URL ??
      inferDashboardBaseUrl(parsed.RAILWAY_PUBLIC_DOMAIN, dashboardPort),
    autopilotBin: parsed.AUTOPILOT_BIN,
    autopilotWorkdir: parsed.AUTOPILOT_WORKDIR
      ? resolveLocalPath(process.cwd(), parsed.AUTOPILOT_WORKDIR)
      : undefined,
    autopilotArtifactsDir: parsed.AUTOPILOT_ARTIFACTS_DIR
      ? resolveLocalPath(process.cwd(), parsed.AUTOPILOT_ARTIFACTS_DIR)
      : undefined,
    autopilotPollIntervalMs: parsed.AUTOPILOT_POLL_INTERVAL_MS,
  };
}

function splitList(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
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

function resolveStoragePath(
  cwd: string,
  configuredPath: string | undefined,
  storageRoot: string | undefined,
  storageChild: string,
  defaultPath: string,
): string {
  if (configuredPath) {
    return resolveLocalPath(cwd, configuredPath);
  }

  if (storageRoot) {
    return path.join(storageRoot, storageChild);
  }

  return resolveLocalPath(cwd, defaultPath);
}

function resolveLocalPath(cwd: string, value: string): string {
  return path.resolve(cwd, value);
}

function resolveRepoSource(cwd: string, value: string): string {
  return isRemoteRepoSpecifier(value)
    ? value
    : resolveLocalPath(cwd, value);
}

function inferDashboardBaseUrl(
  railwayPublicDomain: string | undefined,
  port: number,
): string {
  if (railwayPublicDomain) {
    return `https://${railwayPublicDomain}`;
  }

  return `http://127.0.0.1:${port}`;
}

function isRemoteRepoSpecifier(value: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:\/\/|git@|ssh:\/\/)/i.test(value);
}
