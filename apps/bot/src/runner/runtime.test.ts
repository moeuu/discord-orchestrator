import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createRunnerRuntime } from "./runtime.js";

describe("runner runtime", () => {
  it("prepends the runner node directory and resolves codex/git from it", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "runner-runtime-"));
    const binDir = path.join(tempRoot, "bin");
    const fakeNode = path.join(binDir, "node");
    const fakeCodex = path.join(binDir, "codex");
    const fakeGit = path.join(binDir, "git");

    await fs.mkdir(binDir, { recursive: true });
    for (const filePath of [fakeNode, fakeCodex, fakeGit]) {
      await fs.writeFile(filePath, "#!/bin/sh\nexit 0\n", "utf8");
      await fs.chmod(filePath, 0o755);
    }

    const runtime = createRunnerRuntime({
      cwd: tempRoot,
      env: {
        PATH: "/usr/bin:/bin",
      },
      nodeBin: fakeNode,
      codexBin: "codex",
      gitBin: "git",
    });

    expect(runtime.nodeBin).toBe(fakeNode);
    expect(runtime.codexBin).toBe(fakeCodex);
    expect(runtime.gitBin).toBe(fakeGit);
    expect(runtime.childEnv.PATH?.split(path.delimiter).at(0)).toBe(binDir);
  });
});
