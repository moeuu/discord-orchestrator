import type {
  ChatInputCommandInteraction,
  Client,
  InteractionReplyOptions,
} from "discord.js";
import { Events, MessageFlags } from "discord.js";

import type { AppConfig } from "../config.js";
import { createJobStore, type JobStore } from "../jobs/store.js";
import { createJobService } from "../jobs/service.js";
import type { Logger } from "../util/logger.js";
import type { RunnerTarget } from "../jobs/types.js";
import { buildJobEmbed, buildJobStatusReply } from "./ui.js";

export function attachInteractionHandlers(
  client: Client,
  config: AppConfig,
  logger: Logger,
): void {
  const store = createJobStore(config.jobDataDir);
  const jobs = createJobService(store, config.logDir, logger);

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    try {
      const response = await handleSlashCommand(interaction, store, jobs);
      if (response) {
        await interaction.reply(response);
      }
    } catch (error) {
      logger.error("Command failed", error);

      const content = "コマンド処理中にエラーが発生しました。ログを確認してください。";
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      }
    }
  });
}

async function handleSlashCommand(
  interaction: ChatInputCommandInteraction,
  store: JobStore,
  jobs: ReturnType<typeof createJobService>,
): Promise<InteractionReplyOptions | null> {
  switch (interaction.commandName) {
    case "ping":
      return { content: "pong" };
    case "codex":
      return await handleCodexCommand(interaction, store, jobs);
    default:
      return {
        content: "未対応のコマンドです。",
        flags: MessageFlags.Ephemeral,
      };
  }
}

async function handleCodexCommand(
  interaction: ChatInputCommandInteraction,
  store: JobStore,
  jobs: ReturnType<typeof createJobService>,
): Promise<InteractionReplyOptions | null> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "status": {
      const jobId = interaction.options.getString("job_id");
      const job = await jobs.getJob(jobId);
      return buildJobStatusReply(job);
    }
    case "run":
      await handleCodexRun(interaction, store, jobs);
      return null;
    case "logs": {
      const jobId = interaction.options.getString("job_id", true);
      const logInfo = await jobs.getLogInfo(jobId);
      if (!logInfo.job) {
        return {
          content: `job_id=${jobId} は見つかりません。`,
          flags: MessageFlags.Ephemeral,
        };
      }

      const lines = logInfo.preview
        ? `\n\n\`\`\`\n${truncateLog(logInfo.preview)}\n\`\`\``
        : "";

      return {
        content:
          `log_path: ${logInfo.job.logPath ?? "-"}` +
          lines,
        flags: MessageFlags.Ephemeral,
      };
    }
    case "cancel": {
      const jobId = interaction.options.getString("job_id", true);
      const job = await jobs.cancelJob(jobId);
      if (!job) {
        return {
          content: `job_id=${jobId} は見つかりません。`,
          flags: MessageFlags.Ephemeral,
        };
      }

      return {
        embeds: [buildJobEmbed(job)],
        flags: MessageFlags.Ephemeral,
      };
    }
    default: {
      return {
        content: "未対応の subcommand です。",
        flags: MessageFlags.Ephemeral,
      };
    }
  }
}

async function handleCodexRun(
  interaction: ChatInputCommandInteraction,
  store: JobStore,
  jobs: ReturnType<typeof createJobService>,
): Promise<void> {
  const prompt = interaction.options.getString("prompt", true);
  const target = (interaction.options.getString("target") ?? "local") as RunnerTarget;

  await interaction.deferReply();

  let job = await jobs.createJob({ prompt, target });
  await interaction.editReply({ embeds: [buildJobEmbed(job)] });

  const reply = await interaction.fetchReply();
  job =
    (await store.update(job.jobId, {
      discordMessageId: reply.id,
    })) ?? job;
  await interaction.editReply({ embeds: [buildJobEmbed(job)] });

  void jobs.startDummyRun(job.jobId, async (updatedJob) => {
    await interaction.editReply({ embeds: [buildJobEmbed(updatedJob)] });
  });
}

function truncateLog(value: string): string {
  if (value.length <= 1800) {
    return value;
  }

  return `${value.slice(-1800)}`;
}
