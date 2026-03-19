import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { loadRunnerConfig } from "./config.js";

const originalEnv = { ...process.env };
const originalCwd = process.cwd();

describe("runner config", () => {
  afterEach(() => {
    process.chdir(originalCwd);

    for (const key of Object.keys(process.env)) {
      if (!(key in originalEnv)) {
        delete process.env[key];
      }
    }

    Object.assign(process.env, originalEnv);
  });

  it("loads .runner.env without inheriting bot .env values", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "runner-config-"));
    const fakeCodex = path.join(tempRoot, "bin", "codex");

    await fs.mkdir(path.dirname(fakeCodex), { recursive: true });
    await fs.writeFile(fakeCodex, "#!/bin/sh\nexit 0\n", "utf8");
    await fs.chmod(fakeCodex, 0o755);
    await fs.writeFile(
      path.join(tempRoot, ".runner.env"),
      [
        "RUNNER_ID=macbook",
        "RUNNER_API_BASE_URL=https://runner.example.com",
        "RUNNER_API_TOKEN=runner-token",
        `CODEX_BIN=${fakeCodex}`,
        "WORKSPACE_ROOT=./runner-workspaces",
        "WORKSPACE_SOURCE_REPO=git@github.com:moeuu/discord-orchestrator.git",
        "LOG_LEVEL=debug",
      ].join("\n"),
      "utf8",
    );
    await fs.writeFile(
      path.join(tempRoot, ".env"),
      [
        "RUNNER_API_BASE_URL=https://bot.example.com",
        "CODEX_BIN=/tmp/broken-codex",
        "WORKSPACE_SOURCE_REPO=/tmp/broken-repo",
      ].join("\n"),
      "utf8",
    );

    delete process.env.RUNNER_ID;
    delete process.env.RUNNER_API_BASE_URL;
    delete process.env.RUNNER_API_TOKEN;
    delete process.env.CODEX_BIN;
    delete process.env.WORKSPACE_ROOT;
    delete process.env.WORKSPACE_SOURCE_REPO;
    delete process.env.LOG_LEVEL;
    delete process.env.RUNNER_ENV_FILE;

    process.chdir(tempRoot);

    const config = loadRunnerConfig();
    const realRoot = await fs.realpath(tempRoot);

    expect(config.runnerEnvFile).toBe(
      await fs.realpath(path.join(tempRoot, ".runner.env")),
    );
    expect(config.runnerApiBaseUrl).toBe("https://runner.example.com");
    expect(config.runnerApiToken).toBe("runner-token");
    expect(config.codexBin).toBe(fakeCodex);
    expect(config.workspaceRoot).toBe(path.join(realRoot, "runner-workspaces"));
    expect(config.workspaceSourceRepo).toBe(
      "git@github.com:moeuu/discord-orchestrator.git",
    );
    expect(config.logLevel).toBe("debug");
  });
});
