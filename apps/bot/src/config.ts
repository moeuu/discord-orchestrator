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
