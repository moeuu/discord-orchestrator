import type { SpawnOptionsWithoutStdio } from "node:child_process";
import { spawn } from "node:child_process";

export type Runner = {
  spawn(command: string, args: string[], options?: SpawnOptionsWithoutStdio): ReturnType<typeof spawn>;
};

export function createLocalRunner(): Runner {
  return {
    spawn(command, args, options) {
      return spawn(command, args, options);
    },
  };
}

