import fs from "node:fs";
import path from "node:path";

import dotenv from "dotenv";

export type RunnerRuntime = {
  envFile?: string;
  nodeBin: string;
  nodeDir: string;
  codexBin: string;
  gitBin: string;
  childEnv: NodeJS.ProcessEnv;
};

type RunnerRuntimeOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  envFile?: string;
  nodeBin?: string;
  codexBin?: string;
  gitBin?: string;
};

export function loadRunnerEnv(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const envFile = resolveRunnerEnvFile(cwd, env.RUNNER_ENV_FILE);
  if (!envFile) {
    return undefined;
  }

  if (!fs.existsSync(envFile)) {
    if (env.RUNNER_ENV_FILE) {
      throw new Error(`Runner env file not found: ${envFile}`);
    }

    return undefined;
  }

  dotenv.config({ path: envFile });
  return envFile;
}

export function createRunnerRuntime(
  options: RunnerRuntimeOptions = {},
): RunnerRuntime {
  const cwd = options.cwd ?? process.cwd();
  const baseEnv = options.env ?? process.env;
  const nodeBin = ensureExecutable(
    path.resolve(options.nodeBin ?? process.execPath),
    "node",
  );
  const nodeDir = path.dirname(nodeBin);
  const childEnv = {
    ...baseEnv,
    PATH: prependPath(nodeDir, baseEnv.PATH),
  };

  return {
    envFile: options.envFile,
    nodeBin,
    nodeDir,
    codexBin: resolveExecutable(options.codexBin ?? "codex", {
      cwd,
      env: childEnv,
      label: "codex",
    }),
    gitBin: resolveExecutable(options.gitBin ?? "git", {
      cwd,
      env: childEnv,
      label: "git",
    }),
    childEnv,
  };
}

export function resolveRunnerEnvFile(
  cwd: string,
  envFileValue?: string,
): string | undefined {
  if (envFileValue && envFileValue.trim()) {
    return path.resolve(cwd, envFileValue);
  }

  return path.resolve(cwd, ".runner.env");
}

export function prependPath(directory: string, currentPath?: string): string {
  const entries = [directory];
  if (currentPath) {
    entries.push(
      ...currentPath
        .split(path.delimiter)
        .map((entry) => entry.trim())
        .filter(Boolean),
    );
  }

  return [...new Set(entries)].join(path.delimiter);
}

type ResolveExecutableOptions = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  label: string;
};

export function resolveExecutable(
  command: string,
  options: ResolveExecutableOptions,
): string {
  if (path.isAbsolute(command)) {
    return ensureExecutable(command, options.label);
  }

  if (command.includes(path.sep)) {
    return ensureExecutable(path.resolve(options.cwd, command), options.label);
  }

  const pathValue = options.env.PATH ?? "";
  for (const entry of pathValue.split(path.delimiter)) {
    if (!entry) {
      continue;
    }

    const candidate = path.join(entry, command);
    if (isExecutable(candidate)) {
      return candidate;
    }
  }

  throw new Error(`${options.label} executable not found in PATH: ${command}`);
}

function ensureExecutable(filePath: string, label: string): string {
  if (!isExecutable(filePath)) {
    throw new Error(`${label} executable not found or not executable: ${filePath}`);
  }

  return filePath;
}

function isExecutable(filePath: string): boolean {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
