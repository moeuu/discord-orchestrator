import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "./config.js";

const originalEnv = { ...process.env };

describe("config", () => {
  afterEach(() => {
    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }

    Object.assign(process.env, originalEnv);
  });

  it("keeps remote workspace source repos unchanged", () => {
    process.env.DISCORD_TOKEN = "token";
    process.env.DISCORD_APP_ID = "app-id";
    process.env.DISCORD_GUILD_ID = "guild-id";
    process.env.WORKSPACE_SOURCE_REPO = "git@github.com:moeuu/discord-orchestrator.git";
    process.env.BOT_RUNNER_ID = "macbook";
    process.env.RUNNER_API_TOKEN = "runner-token";

    const config = loadConfig();

    expect(config.workspaceSourceRepo).toBe(
      "git@github.com:moeuu/discord-orchestrator.git",
    );
    expect(config.botRunnerId).toBe("macbook");
    expect(config.runnerApiToken).toBe("runner-token");
  });

  it("derives storage paths and dashboard url from deployment env", () => {
    process.env.DISCORD_TOKEN = "token";
    process.env.DISCORD_APP_ID = "app-id";
    process.env.DISCORD_GUILD_ID = "guild-id";
    process.env.STORAGE_ROOT = "/data";
    process.env.WORKSPACE_ROOT = "";
    process.env.JOB_DATA_DIR = "";
    process.env.LOG_DIR = "";
    process.env.PORT = "3100";
    process.env.RAILWAY_PUBLIC_DOMAIN = "discord-orchestrator.up.railway.app";
    process.env.BOT_RUNNER_ID = "macbook";

    const config = loadConfig();

    expect(config.storageRoot).toBe("/data");
    expect(config.workspaceRoot).toBe("/data/workspaces");
    expect(config.jobDataDir).toBe("/data/data");
    expect(config.logDir).toBe("/data/logs");
    expect(config.dashboardHost).toBe("0.0.0.0");
    expect(config.dashboardPort).toBe(3100);
    expect(config.dashboardBaseUrl).toBe(
      "https://discord-orchestrator.up.railway.app",
    );
  });
});
