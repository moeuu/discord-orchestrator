import type { ChildProcess, SpawnOptions } from "node:child_process";
import { spawn } from "node:child_process";

export type RunResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type Runner = {
  spawn(command: string, args: string[], options?: SpawnOptions): ChildProcess;
  run(command: string, args: string[], options?: SpawnOptions): Promise<RunResult>;
};

export function createLocalRunner(): Runner {
  return {
    spawn(command, args, options) {
      return options ? spawn(command, args, options) : spawn(command, args);
    },
    async run(command, args, options) {
      return await new Promise<RunResult>((resolve, reject) => {
        const child = options
          ? spawn(command, args, options)
          : spawn(command, args);

        let stdout = "";
        let stderr = "";

        child.stdout?.on("data", (chunk) => {
          stdout += chunk.toString();
        });

        child.stderr?.on("data", (chunk) => {
          stderr += chunk.toString();
        });

        child.once("error", (error) => {
          reject(error);
        });

        child.once("close", (exitCode) => {
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
