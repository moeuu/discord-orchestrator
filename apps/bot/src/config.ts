import path from "node:path";

import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const configSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_APPLICATION_ID: z.string().min(1),
  DISCORD_GUILD_ID: z.string().min(1),
  CODEX_BIN: z.string().min(1).default("codex"),
  JOB_DATA_DIR: z.string().min(1).default("../../data"),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type AppConfig = {
  discordToken: string;
  discordApplicationId: string;
  discordGuildId: string;
  codexBin: string;
  jobDataDir: string;
  logLevel: "debug" | "info" | "warn" | "error";
};

export function loadConfig(): AppConfig {
  const parsed = configSchema.parse(process.env);

  return {
    discordToken: parsed.DISCORD_TOKEN,
    discordApplicationId: parsed.DISCORD_APPLICATION_ID,
    discordGuildId: parsed.DISCORD_GUILD_ID,
    codexBin: parsed.CODEX_BIN,
    jobDataDir: path.resolve(process.cwd(), parsed.JOB_DATA_DIR),
    logLevel: parsed.LOG_LEVEL,
  };
}

