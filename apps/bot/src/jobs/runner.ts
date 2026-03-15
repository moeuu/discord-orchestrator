import type { ChildProcess, SpawnOptions } from "node:child_process";
import { spawn } from "node:child_process";

export type Runner = {
  spawn(command: string, args: string[], options?: SpawnOptions): ChildProcess;
};

export function createLocalRunner(): Runner {
  return {
    spawn(command, args, options) {
      return options ? spawn(command, args, options) : spawn(command, args);
    },
  };
}
