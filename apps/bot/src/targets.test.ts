import { describe, expect, it } from "vitest";

import {
  parseCodexTargets,
  resolveCodexTarget,
} from "./targets.js";

describe("targets", () => {
  it("parses local and bridge targets from yaml-like config", () => {
    const targets = parseCodexTargets(`
targets:
  - id: local
    transport: local
    aliases: [local]
  - id: macbook
    displayName: MacBook Pro
    transport: bridge
    bridgeBaseUrl: http://codex-bridge.internal:8788
    sshHost: macbook.tail
    sshUser: moritaeiji
    workspaceRoot: /Users/moritaeiji/.discord-orchestrator/workspaces
    codexBin: codex
    aliases: [macbook, mbp]
`);

    expect(targets).toHaveLength(2);
    expect(targets[1]).toMatchObject({
      id: "macbook",
      displayName: "MacBook Pro",
      transport: "bridge",
      bridgeBaseUrl: "http://codex-bridge.internal:8788",
      sshHost: "macbook.tail",
      sshUser: "moritaeiji",
    });
    expect(targets[1].aliases).toContain("mbp");
  });

  it("resolves targets by id or alias", () => {
    const targets = parseCodexTargets(`
targets:
  - id: macbook
    transport: bridge
    aliases: [macbook, mbp]
`);

    expect(resolveCodexTarget(targets, "macbook")?.id).toBe("macbook");
    expect(resolveCodexTarget(targets, "MBP")?.id).toBe("macbook");
    expect(resolveCodexTarget(targets, "unknown")).toBeNull();
  });
});
