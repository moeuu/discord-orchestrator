import path from "node:path";
import { execFileSync } from "node:child_process";

import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

function emptyToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

// Accept the shorter APP_ID name in env while keeping the old key working.
const configSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APP_ID: z.string().min(1).optional(),
  DISCORD_APPLICATION_ID: z.string().min(1).optional(),
  DISCORD_GUILD_ID: z.string().min(1),
  CODEX_BIN: z.string().min(1).default("codex"),
  WORKSPACE_ROOT: z.string().min(1).default("../../data/workspaces"),
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
  JOB_DATA_DIR: z.string().min(1).default("../../data"),
  LOG_DIR: z.string().min(1).default("../../logs"),
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
  DASHBOARD_PORT: z.coerce.number().int().positive().default(8787),
  DASHBOARD_BASE_URL: z
    .preprocess(emptyToUndefined, z.string().url().optional()),
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
  AUTOPILOT_REMOTE_WATCH_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  AUTOPILOT_REMOTE_WATCH_HOST: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional(),
  ),
  AUTOPILOT_REMOTE_WATCH_RUNNER_ID: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional(),
  ),
  AUTOPILOT_REMOTE_WATCH_CHANNEL_ID: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional(),
  ),
  AUTOPILOT_REMOTE_SESSION_DIR: z
    .string()
    .min(1)
    .default("~/.discord-orchestrator/autopilot-sessions"),
  AUTOPILOT_REMOTE_POLL_INTERVAL_MS: z.coerce
    .number()
    .int()
    .positive()
    .default(5000),
  AUTOPILOT_REMOTE_SESSION_LIMIT: z.coerce
    .number()
    .int()
    .positive()
    .default(10),
  AUTOPILOT_REMOTE_LOG_CHUNK_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(16384),
});

export type AppConfig = {
  discordToken: string;
  discordApplicationId: string;
  discordGuildId: string;
  codexBin: string;
  workspaceRoot: string;
  workspaceSourceRepo: string;
  codexFullAuto: boolean;
  codexSandbox?: "read-only" | "workspace-write" | "danger-full-access";
  jobDataDir: string;
  logDir: string;
  logLevel: "debug" | "info" | "warn" | "error";
  chatCommandsEnabled: boolean;
  chatCommandsRequireMention: boolean;
  chatCommandsAllowedUserIds: string[];
  chatCommandsWorkdir: string;
  dashboardPort: number;
  dashboardBaseUrl: string;
  autopilotBin: string;
  autopilotWorkdir?: string;
  autopilotArtifactsDir?: string;
  autopilotPollIntervalMs: number;
  autopilotRemoteWatchEnabled: boolean;
  autopilotRemoteWatchHost?: string;
  autopilotRemoteWatchRunnerId?: string;
  autopilotRemoteWatchChannelId?: string;
  autopilotRemoteSessionDir: string;
  autopilotRemotePollIntervalMs: number;
  autopilotRemoteSessionLimit: number;
  autopilotRemoteLogChunkBytes: number;
};

export function loadConfig(): AppConfig {
  const parsed = configSchema.parse(process.env);
  const discordApplicationId =
    parsed.DISCORD_APP_ID ?? parsed.DISCORD_APPLICATION_ID;

  if (!discordApplicationId) {
    throw new Error("DISCORD_APP_ID is required");
  }

  const workspaceSourceRepo =
    parsed.WORKSPACE_SOURCE_REPO ??
    detectGitRepoRoot(process.cwd());

  return {
    discordToken: parsed.DISCORD_TOKEN,
    discordApplicationId,
    discordGuildId: parsed.DISCORD_GUILD_ID,
    codexBin: parsed.CODEX_BIN,
    workspaceRoot: path.resolve(process.cwd(), parsed.WORKSPACE_ROOT),
    workspaceSourceRepo: path.resolve(process.cwd(), workspaceSourceRepo),
    codexFullAuto: parsed.CODEX_FULL_AUTO,
    codexSandbox: parsed.CODEX_SANDBOX,
    jobDataDir: path.resolve(process.cwd(), parsed.JOB_DATA_DIR),
    logDir: path.resolve(process.cwd(), parsed.LOG_DIR),
    logLevel: parsed.LOG_LEVEL,
    chatCommandsEnabled: parsed.CHAT_COMMANDS_ENABLED,
    chatCommandsRequireMention: parsed.CHAT_COMMANDS_REQUIRE_MENTION,
    chatCommandsAllowedUserIds: splitList(parsed.CHAT_COMMANDS_ALLOWED_USER_IDS),
    chatCommandsWorkdir: path.resolve(
      process.cwd(),
      parsed.CHAT_COMMANDS_WORKDIR ?? workspaceSourceRepo,
    ),
    dashboardPort: parsed.DASHBOARD_PORT,
    dashboardBaseUrl:
      parsed.DASHBOARD_BASE_URL ??
      `http://127.0.0.1:${parsed.DASHBOARD_PORT}`,
    autopilotBin: parsed.AUTOPILOT_BIN,
    autopilotWorkdir: parsed.AUTOPILOT_WORKDIR
      ? path.resolve(process.cwd(), parsed.AUTOPILOT_WORKDIR)
      : undefined,
    autopilotArtifactsDir: parsed.AUTOPILOT_ARTIFACTS_DIR
      ? path.resolve(process.cwd(), parsed.AUTOPILOT_ARTIFACTS_DIR)
      : undefined,
    autopilotPollIntervalMs: parsed.AUTOPILOT_POLL_INTERVAL_MS,
    autopilotRemoteWatchEnabled: parsed.AUTOPILOT_REMOTE_WATCH_ENABLED,
    autopilotRemoteWatchHost: parsed.AUTOPILOT_REMOTE_WATCH_HOST,
    autopilotRemoteWatchRunnerId:
      parsed.AUTOPILOT_REMOTE_WATCH_RUNNER_ID ??
      parsed.AUTOPILOT_REMOTE_WATCH_HOST,
    autopilotRemoteWatchChannelId: parsed.AUTOPILOT_REMOTE_WATCH_CHANNEL_ID,
    autopilotRemoteSessionDir: parsed.AUTOPILOT_REMOTE_SESSION_DIR,
    autopilotRemotePollIntervalMs: parsed.AUTOPILOT_REMOTE_POLL_INTERVAL_MS,
    autopilotRemoteSessionLimit: parsed.AUTOPILOT_REMOTE_SESSION_LIMIT,
    autopilotRemoteLogChunkBytes: parsed.AUTOPILOT_REMOTE_LOG_CHUNK_BYTES,
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
