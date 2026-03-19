import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createLocalRunner } from "./runner.js";

describe("local runner", () => {
  it("passes its default PATH to child processes", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "local-runner-"));
    const binDir = path.join(tempRoot, "bin");
    const fakeNode = path.join(binDir, "node");
    const inspectNode = path.join(tempRoot, "inspect-node.sh");

    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(fakeNode, "#!/bin/sh\nexit 0\n", "utf8");
    await fs.chmod(fakeNode, 0o755);
    await fs.writeFile(
      inspectNode,
      "#!/bin/sh\ncommand -v node\n",
      "utf8",
    );
    await fs.chmod(inspectNode, 0o755);

    const runner = createLocalRunner({
      env: {
        ...process.env,
        PATH: binDir,
      },
    });

    const result = await runner.run(inspectNode, [], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(fakeNode);
  });
});
