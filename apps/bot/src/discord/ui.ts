import { Colors, EmbedBuilder, type InteractionReplyOptions } from "discord.js";

import type { JobRecord } from "../jobs/types.js";

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
    .setTitle(`Codex Job ${job.jobId}`)
    .setColor(statusColor[job.status])
    .addFields(
      { name: "status", value: job.status, inline: true },
      { name: "target", value: job.target, inline: true },
      { name: "started_at", value: job.startedAt ?? "-", inline: true },
      { name: "finished_at", value: job.finishedAt ?? "-", inline: true },
      { name: "discord_message_id", value: job.discordMessageId ?? "-", inline: false },
      { name: "log_path", value: job.logPath ?? "-", inline: false },
      { name: "prompt", value: truncate(job.prompt), inline: false },
    )
    .setTimestamp(new Date(job.updatedAt));
}

const statusColor = {
  queued: Colors.Grey,
  running: Colors.Blurple,
  succeeded: Colors.Green,
  failed: Colors.Red,
  cancelled: Colors.Orange,
};

function truncate(value: string): string {
  if (value.length <= 1000) {
    return value;
  }

  return `${value.slice(0, 997)}...`;
}
