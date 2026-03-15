import { beforeEach, describe, expect, it, vi } from "vitest";

import type { JobRecord } from "../jobs/types.js";
import { createJobMessageUpdater } from "./ui.js";

function createJob(partial: Partial<JobRecord> = {}): JobRecord {
  return {
    id: "job-1",
    prompt: "test",
    target: "local",
    status: "running",
    created_at: "2026-03-15T00:00:00.000Z",
    updated_at: "2026-03-15T00:00:00.000Z",
    discord_channel_id: "channel-1",
    discord_message_id: "message-1",
    ...partial,
  };
}

describe("createJobMessageUpdater", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T00:00:00.000Z"));
  });

  it("debounces repeated job message updates to one edit per 5 seconds", async () => {
    const edit = vi.fn().mockResolvedValue(undefined);
    const fetchMessage = vi.fn().mockResolvedValue({ edit });
    const fetchChannel = vi.fn().mockResolvedValue({
      isTextBased: () => true,
      messages: {
        fetch: fetchMessage,
      },
    });
    const client = {
      channels: {
        fetch: fetchChannel,
      },
    } as any;
    const logger = {
      debug() {},
      info() {},
      warn() {},
      error() {},
    };

    const updater = createJobMessageUpdater(client, logger);

    const first = updater.updateJobMessage(createJob());
    await vi.runAllTimersAsync();
    await first;

    const second = updater.updateJobMessage(
      createJob({ updated_at: "2026-03-15T00:00:01.000Z" }),
    );
    const third = updater.updateJobMessage(
      createJob({ updated_at: "2026-03-15T00:00:02.000Z", status: "succeeded" }),
    );

    await vi.advanceTimersByTimeAsync(4_999);
    expect(edit).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    await Promise.all([second, third]);

    expect(fetchChannel).toHaveBeenCalledTimes(2);
    expect(fetchMessage).toHaveBeenCalledTimes(2);
    expect(edit).toHaveBeenCalledTimes(2);
  });
});
