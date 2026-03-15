import type { Client, InteractionReplyOptions } from "discord.js";
import { EmbedBuilder } from "discord.js";

import type { JobRecord, JobStatus } from "../jobs/types.js";
import type { Logger } from "../util/logger.js";

const JOB_MESSAGE_DEBOUNCE_MS = 5_000;

type PendingJobMessageUpdate = {
  sending: boolean;
  lastSentAt: number;
  latestJob: JobRecord;
  timer: ReturnType<typeof setTimeout> | null;
  waiters: Array<{
    resolve: () => void;
    reject: (error: unknown) => void;
  }>;
};

export function buildJobStatusReply(
  job: JobRecord | null,
): InteractionReplyOptions {
  if (!job) {
    return {
      content: "ジョブがまだありません。`/codex run` で作成してください。",
    };
  }

  return {
    embeds: [buildJobEmbed(job)],
  };
}

export function buildJobEmbed(job: JobRecord): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`Codex Job ${job.id}`)
    .setColor(statusColor[job.status])
    .addFields(
      { name: "job_id", value: job.id, inline: false },
      { name: "status", value: job.status, inline: true },
      { name: "target", value: job.target, inline: true },
      { name: "pid", value: job.pid ? String(job.pid) : "-", inline: true },
      { name: "last_updated", value: job.updated_at, inline: false },
      { name: "summary", value: truncate(job.summary ?? "-"), inline: false },
      { name: "log_path", value: truncate(job.log_path ?? "-"), inline: false },
    )
    .setTimestamp(new Date(job.updated_at));
}

export function createJobMessageUpdater(
  client: Client,
  logger: Logger,
): {
  updateJobMessage(job: JobRecord): Promise<void>;
} {
  // Keep only the latest pending update per job and send at most once per window.
  const pendingUpdates = new Map<string, PendingJobMessageUpdate>();

  return {
    async updateJobMessage(job) {
      if (!job.discord_channel_id || !job.discord_message_id) {
        return;
      }

      const update = pendingUpdates.get(job.id) ?? {
        sending: false,
        lastSentAt: 0,
        latestJob: job,
        timer: null,
        waiters: [],
      };

      update.latestJob = job;
      pendingUpdates.set(job.id, update);

      return await new Promise<void>((resolve, reject) => {
        update.waiters.push({ resolve, reject });
        scheduleUpdate(job.id);
      });
    },
  };

  function scheduleUpdate(jobId: string): void {
    const update = pendingUpdates.get(jobId);
    if (!update || update.sending || update.timer) {
      return;
    }

    const delayMs = Math.max(
      0,
      JOB_MESSAGE_DEBOUNCE_MS - (Date.now() - update.lastSentAt),
    );

    update.timer = setTimeout(() => {
      update.timer = null;
      void flushUpdate(jobId);
    }, delayMs);
  }

  async function flushUpdate(jobId: string): Promise<void> {
    const update = pendingUpdates.get(jobId);
    if (!update || update.sending) {
      return;
    }

    update.sending = true;
    const waiters = update.waiters.splice(0);
    const job = update.latestJob;

    try {
      const messageId = job.discord_message_id;
      if (!messageId) {
        throw new Error(`Job message id is missing: ${job.id}`);
      }

      const channel = await client.channels.fetch(job.discord_channel_id);
      if (!channel?.isTextBased() || !("messages" in channel)) {
        throw new Error(`Channel is not text-based: ${job.discord_channel_id}`);
      }

      const message = await channel.messages.fetch(messageId);
      await message.edit({ embeds: [buildJobEmbed(job)] });
      update.lastSentAt = Date.now();
      for (const waiter of waiters) {
        waiter.resolve();
      }
    } catch (error) {
      logger.warn(`Failed to update job message ${job.id}`, error);
      for (const waiter of waiters) {
        waiter.reject(error);
      }
    } finally {
      update.sending = false;

      if (update.waiters.length > 0) {
        scheduleUpdate(jobId);
      }
    }
  }
}

const statusColor: Record<JobStatus, number> = {
  queued: 0x95a5a6,
  running: 0x5865f2,
  succeeded: 0x57f287,
  failed: 0xed4245,
  cancelled: 0xfee75c,
};

function truncate(value: string): string {
  if (value.length <= 1000) {
    return value;
  }

  return `${value.slice(0, 997)}...`;
}
