import { EmbedBuilder, type InteractionReplyOptions } from "discord.js";

import type { JobRecord, JobStatus } from "../jobs/types.js";

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
      { name: "status", value: job.status, inline: true },
      { name: "target", value: job.target, inline: true },
      { name: "started_at", value: job.started_at ?? "-", inline: true },
      { name: "finished_at", value: job.finished_at ?? "-", inline: true },
      {
        name: "discord_channel_id",
        value: job.discord_channel_id,
        inline: false,
      },
      {
        name: "discord_message_id",
        value: job.discord_message_id ?? "-",
        inline: false,
      },
      { name: "log_path", value: job.log_path ?? "-", inline: false },
      { name: "summary", value: truncate(job.summary ?? "-"), inline: false },
      { name: "prompt", value: truncate(job.prompt), inline: false },
    )
    .setTimestamp(new Date(job.updated_at));
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
