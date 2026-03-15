import fs from "node:fs/promises";

import type {
  Client,
  Message,
  ThreadChannel,
} from "discord.js";

import type { JobStore } from "../jobs/store.js";
import type { JobRecord } from "../jobs/types.js";
import type { Logger } from "../util/logger.js";

const MAX_DISCORD_CHUNK = 1800;
const STREAM_DEBOUNCE_MS = 4000;

type PendingLogUpdate = {
  sending: boolean;
  lastSentAt: number;
  latestJob: JobRecord;
  timer: ReturnType<typeof setTimeout> | null;
  waiters: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
  }>;
};

type LogDestination = {
  id: string;
  isThread: boolean;
  send(payload: { content: string }): Promise<unknown>;
};

export function createJobLogStreamer(
  client: Client,
  store: JobStore,
  logger: Logger,
): {
  streamJobLogs(job: JobRecord): Promise<void>;
} {
  const pending = new Map<string, PendingLogUpdate>();

  return {
    async streamJobLogs(job) {
      if (job.tool !== "autopilot" || !job.log_path || !job.discord_message_id) {
        return;
      }

      const state = pending.get(job.id) ?? {
        sending: false,
        lastSentAt: 0,
        latestJob: job,
        timer: null,
        waiters: [],
      };

      state.latestJob = job;
      pending.set(job.id, state);

      return await new Promise<void>((resolve, reject) => {
        state.waiters.push({ resolve, reject });
        schedule(job.id);
      });
    },
  };

  function schedule(jobId: string): void {
    const state = pending.get(jobId);
    if (!state || state.sending || state.timer) {
      return;
    }

    const delayMs = Math.max(
      0,
      STREAM_DEBOUNCE_MS - (Date.now() - state.lastSentAt),
    );

    state.timer = setTimeout(() => {
      state.timer = null;
      void flush(jobId);
    }, delayMs);
  }

  async function flush(jobId: string): Promise<void> {
    const state = pending.get(jobId);
    if (!state || state.sending) {
      return;
    }

    state.sending = true;
    const waiters = state.waiters.splice(0);

    try {
      const refreshed = await store.get(jobId);
      const job = refreshed ?? state.latestJob;
      const postedJob = await postJobLogDelta(job);
      state.latestJob = postedJob;
      state.lastSentAt = Date.now();

      for (const waiter of waiters) {
        waiter.resolve();
      }
    } catch (error) {
      logger.warn(`Failed to stream logs for job ${jobId}`, error);
      for (const waiter of waiters) {
        waiter.reject(error);
      }
    } finally {
      state.sending = false;
      if (state.waiters.length > 0) {
        schedule(jobId);
      }
    }
  }

  async function postJobLogDelta(job: JobRecord): Promise<JobRecord> {
    if (!job.log_path) {
      return job;
    }

    const contents = await fs.readFile(job.log_path, "utf8").catch(() => "");
    const currentOffset = job.log_stream_offset ?? 0;
    if (contents.length <= currentOffset) {
      return job;
    }

    const nextChunk = contents.slice(currentOffset);
    const trimmed = nextChunk.trim();
    if (!trimmed) {
      return job;
    }

    const destination = await ensureDestination(job);
    const chunks = chunkForDiscord(trimmed);

    for (const chunk of chunks) {
      await destination.send({
        content: `\`\`\`\n${chunk}\n\`\`\``,
      });
    }

    return await store.update(job.id, {
      discord_thread_id: destination.isThread ? destination.id : job.discord_thread_id,
      log_stream_offset: contents.length,
    });
  }

  async function ensureDestination(job: JobRecord): Promise<LogDestination> {
    if (job.discord_thread_id) {
      const existing = await client.channels.fetch(job.discord_thread_id);
      if (existing?.isTextBased() && "send" in existing) {
        return {
          id: existing.id,
          isThread: existing.isThread(),
          send: existing.send.bind(existing),
        };
      }
    }

    const channel = await client.channels.fetch(job.discord_channel_id);
    if (!channel?.isTextBased() || !("messages" in channel) || !("send" in channel)) {
      throw new Error(`Channel is not text-based: ${job.discord_channel_id}`);
    }

    const message = await channel.messages.fetch(job.discord_message_id!);
    const thread = await startLogThread(message, job, logger);
    if (thread) {
      await store.update(job.id, { discord_thread_id: thread.id });
      return {
        id: thread.id,
        isThread: true,
        send: thread.send.bind(thread),
      };
    }

    return {
      id: channel.id,
      isThread: false,
      send: channel.send.bind(channel),
    };
  }
}

async function startLogThread(
  message: Message,
  job: JobRecord,
  logger: Logger,
): Promise<ThreadChannel | null> {
  try {
    const thread = await message.startThread({
      name: `${job.tool}-${job.id.slice(0, 8)}-logs`,
      autoArchiveDuration: 1440,
      reason: `Live logs for job ${job.id}`,
    });

    await thread.send(
      `Autopilot log stream started for job \`${job.id}\`. New log lines will be posted here.`,
    );
    return thread;
  } catch (error) {
    logger.warn(`Falling back to channel log streaming for job ${job.id}`, error);
    return null;
  }
}

export function chunkForDiscord(value: string): string[] {
  const chunks: string[] = [];
  let remaining = value;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_DISCORD_CHUNK) {
      chunks.push(remaining);
      break;
    }

    let slice = remaining.slice(0, MAX_DISCORD_CHUNK);
    const lastBreak = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
    if (lastBreak > 200) {
      slice = slice.slice(0, lastBreak);
    }
    chunks.push(slice);
    remaining = remaining.slice(slice.length).trimStart();
  }

  return chunks;
}
