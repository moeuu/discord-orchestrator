import type { ChildProcess, SpawnOptions } from "node:child_process";
import { spawn } from "node:child_process";

export type RunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type RunnerDefaults = {
  env?: NodeJS.ProcessEnv;
};

export type Runner = {
  spawn(command: string, args: string[], options?: SpawnOptions): ChildProcess;
  run(command: string, args: string[], options?: SpawnOptions): Promise<RunResult>;
};

export function createLocalRunner(defaults: RunnerDefaults = {}): Runner {
  return {
    spawn(command, args, options) {
      const spawnOptions = withDefaultEnv(defaults.env, options);
      return spawnOptions
        ? spawn(command, args, spawnOptions)
        : spawn(command, args);
    },
    async run(command, args, options) {
      return await new Promise<RunResult>((resolve, reject) => {
        const spawnOptions = withDefaultEnv(defaults.env, options);
        const child = spawnOptions
          ? spawn(command, args, spawnOptions)
          : spawn(command, args);

        let stdout = "";
        let stderr = "";

        child.stdout?.on("data", (chunk: Buffer | string) => {
          stdout += chunk.toString();
        });

        child.stderr?.on("data", (chunk: Buffer | string) => {
          stderr += chunk.toString();
        });

        child.once("error", (error: Error) => {
          reject(error);
        });

        child.once("close", (exitCode: number | null) => {
          resolve({
            exitCode: exitCode ?? 1,
            stdout,
            stderr,
          });
        });
      });
    },
  };
}

function withDefaultEnv(
  defaultEnv: NodeJS.ProcessEnv | undefined,
  options?: SpawnOptions,
): SpawnOptions | undefined {
  if (!defaultEnv) {
    return options;
  }

  return {
    ...(options ?? {}),
    env: {
      ...defaultEnv,
      ...(options?.env ?? {}),
    },
  };
}
