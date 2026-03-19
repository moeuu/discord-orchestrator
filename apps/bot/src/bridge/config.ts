import path from "node:path";

import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

function emptyToUndefined(value: unknown): unknown {
  return value === "" ? undefined : value;
}

const bridgeConfigSchema = z.object({
  TARGETS_CONFIG_PATH: z.string().min(1).default("../../config/targets.yaml"),
  RUNNER_BRIDGE_AUTH_TOKEN: z.preprocess(
    emptyToUndefined,
    z.string().min(1).optional(),
  ),
  BRIDGE_BIND_HOST: z.string().min(1).default("0.0.0.0"),
  PORT: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
  BRIDGE_PORT: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int().positive().optional(),
  ),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type BridgeConfig = {
  targetsConfigPath: string;
  authToken?: string;
  bindHost: string;
  port: number;
  logLevel: "debug" | "info" | "warn" | "error";
};

export function loadBridgeConfig(): BridgeConfig {
  const parsed = bridgeConfigSchema.parse(process.env);

  return {
    targetsConfigPath: path.resolve(process.cwd(), parsed.TARGETS_CONFIG_PATH),
    authToken: parsed.RUNNER_BRIDGE_AUTH_TOKEN,
    bindHost: parsed.BRIDGE_BIND_HOST,
    port: parsed.BRIDGE_PORT ?? parsed.PORT ?? 8788,
    logLevel: parsed.LOG_LEVEL,
  };
}
