import type {
  ChatInputCommandInteraction,
  Client,
  InteractionReplyOptions,
} from "discord.js";
import { Events, MessageFlags } from "discord.js";

import type { AppConfig } from "../config.js";
import { createJobLogStreamer } from "./logStream.js";
import type { JobStore } from "../jobs/store.js";
import type { Logger } from "../util/logger.js";
import type { JobRecord, RunnerTarget } from "../jobs/types.js";
import {
  buildJobEmbed,
  buildJobStatusReply,
  createJobMessageUpdater,
} from "./ui.js";
import type { createJobService } from "../jobs/service.js";

type JobService = ReturnType<typeof createJobService>;
type UpdateJobMessage = (job: JobRecord) => Promise<void>;
type StreamJobLogs = (job: JobRecord) => Promise<void>;

export function attachInteractionHandlers(
  client: Client,
  config: AppConfig,
  logger: Logger,
  store: JobStore,
  jobs: JobService,
): void {
  const jobMessages = createJobMessageUpdater(client, logger);
  const logStreamer = createJobLogStreamer(client, store, logger);

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    try {
      const response = await handleSlashCommand(
        interaction,
        config,
        store,
        jobs,
        jobMessages.updateJobMessage,
        logStreamer.streamJobLogs,
      );
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
  config: AppConfig,
  store: JobStore,
  jobs: JobService,
  updateJobMessage: UpdateJobMessage,
  streamJobLogs: StreamJobLogs,
): Promise<InteractionReplyOptions | null> {
  switch (interaction.commandName) {
    case "ping":
      return { content: "pong" };
    case "codex":
      return await handleCodexCommand(interaction, store, jobs, updateJobMessage);
    case "autopilot":
      return await handleAutopilotCommand(
        interaction,
        config,
        store,
        jobs,
        updateJobMessage,
        streamJobLogs,
      );
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
  jobs: JobService,
  updateJobMessage: UpdateJobMessage,
): Promise<InteractionReplyOptions | null> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "status": {
      const jobId = interaction.options.getString("job_id");
      const job = await jobs.getJob(jobId);
      return buildJobStatusReply(job);
    }
    case "run":
      await handleCodexRun(interaction, store, jobs, updateJobMessage);
      return null;
    case "logs":
      return await handleLogs(interaction, jobs);
    case "cancel":
      return await handleCancel(interaction, jobs);
    default:
      return unsupportedSubcommand();
  }
}

async function handleAutopilotCommand(
  interaction: ChatInputCommandInteraction,
  config: AppConfig,
  store: JobStore,
  jobs: JobService,
  updateJobMessage: UpdateJobMessage,
  streamJobLogs: StreamJobLogs,
): Promise<InteractionReplyOptions | null> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "status": {
      const jobId = interaction.options.getString("job_id");
      const job = await jobs.getJob(jobId);
      return buildJobStatusReply(job);
    }
    case "run":
      await handleAutopilotRun(
        interaction,
        config,
        store,
        jobs,
        updateJobMessage,
        streamJobLogs,
      );
      return null;
    case "logs":
      return await handleLogs(interaction, jobs);
    case "cancel":
      return await handleCancel(interaction, jobs);
    default:
      return unsupportedSubcommand();
  }
}

async function handleCodexRun(
  interaction: ChatInputCommandInteraction,
  store: JobStore,
  jobs: JobService,
  updateJobMessage: UpdateJobMessage,
): Promise<void> {
  const prompt = interaction.options.getString("prompt", true);
  const target = (interaction.options.getString("target") ?? "local") as RunnerTarget;
  const discordChannelId = interaction.channelId ?? "unknown";

  await interaction.deferReply();

  let job = await jobs.createJob({ prompt, target, discordChannelId });
  await interaction.editReply({ embeds: [buildJobEmbed(job)] });

  const reply = await interaction.fetchReply();
  job = await store.update(job.id, {
    discord_message_id: reply.id,
  });
  await interaction.editReply({ embeds: [buildJobEmbed(job)] });

  void jobs.startJob(job.id, async (updatedJob) => {
    await updateJobMessage(updatedJob);
  });
}

async function handleAutopilotRun(
  interaction: ChatInputCommandInteraction,
  config: AppConfig,
  store: JobStore,
  jobs: JobService,
  updateJobMessage: UpdateJobMessage,
  streamJobLogs: StreamJobLogs,
): Promise<void> {
  const competition = interaction.options.getString("competition", true);
  const instruction = interaction.options.getString("instruction", true);
  const compute = interaction.options.getString("compute") ?? "local_gpu";
  const maxIterations = interaction.options.getInteger("max_iterations") ?? 5;
  const dryRun = interaction.options.getBoolean("dry_run") ?? true;
  const runnerId = interaction.options.getString("runner") ?? "lab_rdp";
  const target = runnerId === "local" ? "local" : "ssh";
  const discordChannelId = interaction.channelId ?? "unknown";

  await interaction.deferReply();

  let job = await jobs.createAutopilotJob({
    competition,
    instruction,
    compute,
    maxIterations,
    dryRun,
    target,
    runnerId,
    discordChannelId,
    dashboardBaseUrl: config.dashboardBaseUrl,
  });
  await interaction.editReply({ embeds: [buildJobEmbed(job)] });

  const reply = await interaction.fetchReply();
  job = await store.update(job.id, {
    discord_message_id: reply.id,
  });
  await interaction.editReply({ embeds: [buildJobEmbed(job)] });

  void jobs.startAutopilotJob(job.id, async (updatedJob) => {
    await updateJobMessage(updatedJob);
    await streamJobLogs(updatedJob);
  });
}

async function handleLogs(
  interaction: ChatInputCommandInteraction,
  jobs: JobService,
): Promise<InteractionReplyOptions> {
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
    content: `log_path: ${logInfo.job.log_path ?? "-"}${lines}`,
    flags: MessageFlags.Ephemeral,
  };
}

async function handleCancel(
  interaction: ChatInputCommandInteraction,
  jobs: JobService,
): Promise<InteractionReplyOptions> {
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

function unsupportedSubcommand(): InteractionReplyOptions {
  return {
    content: "未対応の subcommand です。",
    flags: MessageFlags.Ephemeral,
  };
}

function truncateLog(value: string): string {
  if (value.length <= 1800) {
    return value;
  }

  return `${value.slice(-1800)}`;
}
