import { describe, expect, it } from "vitest";

import type { JobRecord } from "../jobs/types.js";
import {
  findLatestCodexSessionId,
  shouldStartNewCodexSession,
  stripCodexSessionDirective,
} from "./handlers.js";

function createJob(partial: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    tool: "codex",
    prompt: "prompt",
    target: "runner",
    status: "succeeded",
    created_at: "2026-03-19T00:00:00.000Z",
    updated_at: "2026-03-19T00:00:00.000Z",
    discord_channel_id: "channel-1",
    runner_id: "macbook",
    ...partial,
  };
}

describe("codex session helpers", () => {
  it("reuses the latest thread id for the same channel and runner", () => {
    const sessionId = findLatestCodexSessionId(
      [
        createJob({ id: "job-3", external_id: "thread-latest" }),
        createJob({ id: "job-2" }),
        createJob({
          id: "job-1",
          external_id: "thread-older",
        }),
        createJob({
          id: "job-4",
          discord_channel_id: "channel-2",
          external_id: "thread-other-channel",
        }),
      ],
      "channel-1",
      "macbook",
    );

    expect(sessionId).toBe("thread-latest");
  });

  it("detects explicit new session directives", () => {
    expect(shouldStartNewCodexSession("新しいセッションで README を直して")).toBe(true);
    expect(shouldStartNewCodexSession("reset session: fix tests")).toBe(true);
    expect(shouldStartNewCodexSession("README を直して")).toBe(false);
  });

  it("strips leading new session directives from prompts", () => {
    expect(stripCodexSessionDirective("新しいセッションで: README を直して")).toBe(
      "README を直して",
    );
    expect(stripCodexSessionDirective("new session: fix tests")).toBe(
      "fix tests",
    );
    expect(stripCodexSessionDirective("README を直して")).toBe(
      "README を直して",
    );
  });
});
