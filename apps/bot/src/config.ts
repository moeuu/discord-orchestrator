import path from "node:path";

import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

// Accept the shorter APP_ID name in env while keeping the old key working.
const configSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APP_ID: z.string().min(1).optional(),
  DISCORD_APPLICATION_ID: z.string().min(1).optional(),
  DISCORD_GUILD_ID: z.string().min(1),
  CODEX_BIN: z.string().min(1).default("codex"),
  JOB_DATA_DIR: z.string().min(1).default("../../data"),
  LOG_DIR: z.string().min(1).default("../../logs"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type AppConfig = {
  discordToken: string;
  discordApplicationId: string;
  discordGuildId: string;
  codexBin: string;
  jobDataDir: string;
  logDir: string;
  logLevel: "debug" | "info" | "warn" | "error";
};

export function loadConfig(): AppConfig {
  const parsed = configSchema.parse(process.env);
  const discordApplicationId =
    parsed.DISCORD_APP_ID ?? parsed.DISCORD_APPLICATION_ID;

  if (!discordApplicationId) {
    throw new Error("DISCORD_APP_ID is required");
  }

  return {
    discordToken: parsed.DISCORD_TOKEN,
    discordApplicationId,
    discordGuildId: parsed.DISCORD_GUILD_ID,
    codexBin: parsed.CODEX_BIN,
    jobDataDir: path.resolve(process.cwd(), parsed.JOB_DATA_DIR),
    logDir: path.resolve(process.cwd(), parsed.LOG_DIR),
    logLevel: parsed.LOG_LEVEL,
  };
}
