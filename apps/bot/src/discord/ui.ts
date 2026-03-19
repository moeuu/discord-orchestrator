import type { Client, InteractionReplyOptions } from "discord.js";
import { EmbedBuilder } from "discord.js";

import type { JobRecord, JobStatus } from "../jobs/types.js";
import type { Logger } from "../util/logger.js";

const JOB_MESSAGE_DEBOUNCE_MS = 2_000;

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
  const progress = job.progress;
  const detailLinks = [
    job.discord_thread_id ? `<#${job.discord_thread_id}>` : null,
    job.dashboard_url ? `[dashboard](${job.dashboard_url})` : null,
  ]
    .filter(Boolean)
    .join(" / ");

  const embed = new EmbedBuilder()
    .setTitle(`${toolLabel(job.tool)} ${statusLabel[job.status]}`)
    .setColor(statusColor[job.status])
    .setDescription(truncate(job.summary ?? defaultSummary(job)))
    .addFields(
      {
        name: "状態",
        value: `${statusEmoji[job.status]} ${statusLabel[job.status]}`,
        inline: true,
      },
      {
        name: "実行先",
        value: job.runner_id ?? job.target,
        inline: true,
      },
      {
        name: "更新",
        value: formatDiscordTimestamp(job.updated_at),
        inline: true,
      },
      {
        name: "依頼",
        value: formatRequest(job),
        inline: false,
      },
    );

  if (job.status !== "queued" || job.summary) {
    embed.addFields({
      name: job.status === "running" ? "最新状況" : "結果",
      value: truncate(job.summary ?? "-"),
      inline: false,
    });
  }

  if (detailLinks) {
    embed.addFields({
      name: "詳細",
      value: detailLinks,
      inline: false,
    });
  }

  if (progress) {
    if (job.tool === "codex") {
      embed.addFields(
        { name: "フェーズ", value: progress.phase ?? "-", inline: true },
        {
          name: "今していること",
          value: truncate(progress.activity ?? progress.latest_agent_message ?? "-"),
          inline: false,
        },
        {
          name: "直近ログ",
          value: formatRecentLogs(progress.recent_logs),
          inline: false,
        },
      );
    } else {
      embed.addFields(
        { name: "フェーズ", value: progress.phase ?? "-", inline: true },
        {
          name: "iter",
          value:
            typeof progress.current_iter === "number"
              ? `${progress.current_iter}${typeof progress.max_iterations === "number" ? ` / ${progress.max_iterations}` : ""}`
              : "-",
          inline: true,
        },
        {
          name: "指標",
          value: progress.best_metric_name && progress.best_metric
            ? `${progress.best_metric_name}: ${progress.best_metric}`
            : progress.best_metric ?? "-",
          inline: true,
        },
        {
          name: "方針",
          value: truncate(
            progress.strategy_summary ??
              progress.latest_agent_message ??
              "-",
          ),
          inline: false,
        },
      );
    }
  }

  return embed
    .setFooter({
      text: `job ${job.id}${job.pid ? ` · pid ${job.pid}` : ""}`,
    })
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

const statusEmoji: Record<JobStatus, string> = {
  queued: "⏳",
  running: "🟦",
  succeeded: "✅",
  failed: "❌",
  cancelled: "🟨",
};

const statusLabel: Record<JobStatus, string> = {
  queued: "待機中",
  running: "実行中",
  succeeded: "完了",
  failed: "失敗",
  cancelled: "停止",
};

function truncate(value: string): string {
  if (value.length <= 1000) {
    return value;
  }

  return `${value.slice(0, 997)}...`;
}

function toolLabel(value: JobRecord["tool"]): string {
  switch (value) {
    case "codex":
      return "Codex";
    case "autopilot":
      return "Autopilot";
    case "shell":
      return "Shell";
  }
}

function formatRequest(job: JobRecord): string {
  return truncate(
    code(job.prompt || "-"),
  );
}

function formatDiscordTimestamp(value: string): string {
  const unix = Math.floor(new Date(value).getTime() / 1000);
  if (!Number.isFinite(unix)) {
    return value;
  }

  return `<t:${unix}:f>\n<t:${unix}:R>`;
}

function defaultSummary(job: JobRecord): string {
  switch (job.status) {
    case "queued":
      return "ジョブをキューに追加しました。";
    case "running":
      return "処理を開始しました。";
    case "succeeded":
      return "処理が完了しました。";
    case "failed":
      return "処理が失敗しました。";
    case "cancelled":
      return "処理を停止しました。";
  }
}

function code(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact ? `\`${compact.slice(0, 980)}\`` : "-";
}

function formatRecentLogs(value: string[] | undefined): string {
  if (!value || value.length === 0) {
    return "-";
  }

  return truncate(
    value
      .slice(-4)
      .map((entry) => `• ${entry}`)
      .join("\n"),
  );
}
