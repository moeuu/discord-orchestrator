import { describe, expect, it } from "vitest";

import {
  extractMentionCodexRequest,
  stripBotMention,
} from "./codexMention.js";
import type { CodexTarget } from "../targets.js";

const targets: CodexTarget[] = [
  {
    id: "macbook",
    displayName: "MacBook",
    transport: "bridge",
    bridgeBaseUrl: "http://codex-bridge.internal:8788",
    sshHost: "macbook.tail",
    sshUser: "moritaeiji",
    workspaceRoot: "/Users/moritaeiji/.discord-orchestrator/workspaces",
    codexBin: "codex",
    aliases: ["macbook", "mbp"],
  },
];

describe("codex mention targeting", () => {
  it("strips user and role mentions", () => {
    expect(
      stripBotMention("<@123> macbook: fix the tests", "123", ["999"]),
    ).toBe("macbook: fix the tests");
    expect(
      stripBotMention("<@&999> on macbook inspect this repo", "123", ["999"]),
    ).toBe("on macbook inspect this repo");
  });

  it("extracts explicit target prefixes", () => {
    expect(
      extractMentionCodexRequest(
        "<@123> macbook: fix the tests",
        targets,
        "macbook",
        "123",
      ),
    ).toEqual({
      targetId: "macbook",
      prompt: "fix the tests",
    });

    expect(
      extractMentionCodexRequest(
        "<@123> on mbp inspect the repo",
        targets,
        "macbook",
        "123",
      ),
    ).toEqual({
      targetId: "macbook",
      prompt: "inspect the repo",
    });
  });

  it("supports japanese target phrasing and default target fallback", () => {
    expect(
      extractMentionCodexRequest(
        "<@123> macbookで README を直して",
        targets,
        "macbook",
        "123",
      ),
    ).toEqual({
      targetId: "macbook",
      prompt: "README を直して",
    });

    expect(
      extractMentionCodexRequest(
        "<@123> この repo のテストを見て",
        targets,
        "macbook",
        "123",
        [],
        { fallbackToDefault: true },
      ),
    ).toEqual({
      targetId: "macbook",
      prompt: "この repo のテストを見て",
    });
  });
});
