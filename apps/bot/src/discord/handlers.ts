import type {
  ChatInputCommandInteraction,
  Client,
  InteractionReplyOptions,
} from "discord.js";
import { Events, MessageFlags } from "discord.js";

import type { AppConfig } from "../config.js";
import { extractChatShellCommand, stripBotMention } from "./chatCommands.js";
import { createChatLlmRouter } from "./chatLlmRouter.js";
import { createChatSessionStore } from "./chatSessionStore.js";
import { shouldResetChatSession } from "./chatLlmRouter.js";
import type { JobStore } from "../jobs/store.js";
import type { Logger } from "../util/logger.js";
import type { JobRecord } from "../jobs/types.js";
import {
  buildJobEmbed,
  buildJobStatusReply,
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
  ui: {
    updateJobMessage: UpdateJobMessage;
    streamJobLogs: StreamJobLogs;
  },
): void {
  const chatSessions = createChatSessionStore(config.jobDataDir);
  const chatLlmRouter =
    config.chatLlmEnabled
      ? createChatLlmRouter(
          {
            codexBin: config.codexBin,
            model: config.chatLlmModel,
            workdir: config.chatCommandsWorkdir,
            sessions: chatSessions,
          },
          logger,
        )
      : null;

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
        ui.updateJobMessage,
        ui.streamJobLogs,
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

  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot) {
      return;
    }

    const botUserId = client.user?.id ?? "";
    const botRoleIds = message.guild?.roles.cache
      .filter((role) => role.name === (client.user?.username ?? ""))
      .map((role) => role.id) ?? [];
    const mentionsBot =
      message.mentions.users.has(botUserId) ||
      message.mentions.roles.some((role) => botRoleIds.includes(role.id));

    logger.info("Observed guild message", {
      authorId: message.author.id,
      channelId: message.channelId,
      mentionsBot,
      botRoleIds,
      chatCommandsEnabled: config.chatCommandsEnabled,
      requireMention: config.chatCommandsRequireMention,
      preview: message.content.slice(0, 160),
    });

    if (!config.chatCommandsEnabled) {
      return;
    }

    if (config.chatCommandsRequireMention && !mentionsBot) {
      logger.info("Ignored message without bot mention", {
        authorId: message.author.id,
        channelId: message.channelId,
      });
      return;
    }

    if (
      config.chatCommandsAllowedUserIds.length > 0 &&
      !config.chatCommandsAllowedUserIds.includes(message.author.id)
    ) {
      logger.info("Ignored message from non-allowlisted user", {
        authorId: message.author.id,
        channelId: message.channelId,
      });
      return;
    }

    logger.info("Received chat mention", {
      authorId: message.author.id,
      channelId: message.channelId,
      usesLlm: config.chatLlmEnabled,
      preview: message.content.slice(0, 160),
    });

    const prompt = stripBotMention(
      message.content,
      client.user?.id,
      botRoleIds,
    ).trim();
    const command = extractChatShellCommand(
      message.content,
      client.user?.id,
      botRoleIds,
    );

    try {
      if (command) {
        await launchShellJob(
          command,
          "",
          message.channelId,
          message,
          store,
          jobs,
          ui.updateJobMessage,
          ui.streamJobLogs,
        );
        return;
      }

      if (config.chatLlmEnabled) {
        if (!chatLlmRouter) {
          await message.reply("Chat LLM router を初期化できませんでした。");
          return;
        }

        const action = await chatLlmRouter.route({
          content: message.content,
          sessionKey: message.channelId,
          botUserId: client.user?.id,
          botRoleIds,
          resetSession: shouldResetChatSession(message.content),
        });

        logger.info("Chat mention routed", {
          action: action.action,
          rationale: action.rationale,
        });

        switch (action.action) {
          case "reply":
            await message.reply(
              action.message || "どう処理すべきか判断できませんでした。",
            );
            return;
          case "shell":
            if (!action.shell_command.trim()) {
              await message.reply("実行する shell command を決められませんでした。");
              return;
            }
            await launchShellJob(
              action.shell_command,
              action.message,
              message.channelId,
              message,
              store,
              jobs,
              ui.updateJobMessage,
              ui.streamJobLogs,
            );
            return;
          case "codex":
            if (!action.codex_prompt.trim()) {
              await message.reply("Codex に渡す prompt を決められませんでした。");
              return;
            }
            await launchCodexJob(
              action.codex_prompt,
              action.message,
              config.botRunnerId,
              message.channelId,
              shouldStartNewCodexSession(message.content),
              message,
              store,
              jobs,
            );
            return;
        }
      }

      if (!prompt) {
        return;
      }

      await launchCodexJob(
        prompt,
        "",
        config.botRunnerId,
        message.channelId,
        shouldStartNewCodexSession(message.content),
        message,
        store,
        jobs,
      );
    } catch (error) {
      logger.error("Chat command failed", error);
      await message.reply("コマンド実行の開始に失敗しました。");
    }
  });
}

async function launchShellJob(
  command: string,
  prefixMessage: string,
  discordChannelId: string,
  message: {
    reply(options: { content?: string; embeds?: InteractionReplyOptions["embeds"] }): Promise<{ id: string; edit(options: { embeds: InteractionReplyOptions["embeds"] }): Promise<unknown> }>;
  },
  store: JobStore,
  jobs: JobService,
  updateJobMessage: UpdateJobMessage,
  streamJobLogs: StreamJobLogs,
): Promise<void> {
  let job = await jobs.createShellJob({
    command,
    discordChannelId,
  });
  const reply = await message.reply({
    content: prefixMessage || undefined,
    embeds: [buildJobEmbed(job)],
  });
  job = await store.update(job.id, {
    discord_message_id: reply.id,
  });
  await reply.edit({ embeds: [buildJobEmbed(job)] });

  void jobs.startShellJob(job.id, async (updatedJob) => {
    await updateJobMessage(updatedJob);
    await streamJobLogs(updatedJob);
  });
}

async function launchCodexJob(
  prompt: string,
  prefixMessage: string,
  runnerId: string,
  discordChannelId: string,
  startNewSession: boolean,
  message: {
    reply(options: { content?: string; embeds?: InteractionReplyOptions["embeds"] }): Promise<{ id: string; edit(options: { embeds: InteractionReplyOptions["embeds"] }): Promise<unknown> }>;
  },
  store: JobStore,
  jobs: JobService,
): Promise<void> {
  const normalizedPrompt = stripCodexSessionDirective(prompt);
  const externalId = startNewSession
    ? undefined
    : await resolveLatestCodexSessionId(store, discordChannelId, runnerId);
  let job = await jobs.createJob({
    prompt: normalizedPrompt,
    target: "runner",
    runnerId,
    discordChannelId,
    externalId,
  });
  const reply = await message.reply({
    content: prefixMessage || undefined,
    embeds: [buildJobEmbed(job)],
  });
  job = await store.update(job.id, {
    discord_message_id: reply.id,
  });
  await reply.edit({ embeds: [buildJobEmbed(job)] });
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
      return await handleCodexCommand(
        interaction,
        config,
        store,
        jobs,
      );
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
  config: AppConfig,
  store: JobStore,
  jobs: JobService,
): Promise<InteractionReplyOptions | null> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "status": {
      const jobId = interaction.options.getString("job_id");
      const job = await jobs.getJob(jobId);
      return buildJobStatusReply(job);
    }
    case "run":
      await handleCodexRun(interaction, config, store, jobs);
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
  config: AppConfig,
  store: JobStore,
  jobs: JobService,
): Promise<void> {
  const prompt = interaction.options.getString("prompt", true);
  const newSession = interaction.options.getBoolean("new_session") ?? false;
  const discordChannelId = interaction.channelId ?? "unknown";

  await interaction.deferReply();

  const normalizedPrompt = stripCodexSessionDirective(prompt);
  const externalId = newSession
    ? undefined
    : await resolveLatestCodexSessionId(
        store,
        discordChannelId,
        config.botRunnerId,
      );
  let job = await jobs.createJob({
    prompt: normalizedPrompt,
    target: "runner",
    runnerId: config.botRunnerId,
    discordChannelId,
    externalId,
  });
  await interaction.editReply({ embeds: [buildJobEmbed(job)] });

  const reply = await interaction.fetchReply();
  job = await store.update(job.id, {
    discord_message_id: reply.id,
  });
  await interaction.editReply({ embeds: [buildJobEmbed(job)] });
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
  const discordChannelId = interaction.channelId ?? "unknown";

  await interaction.deferReply();

  let job = await jobs.createAutopilotJob({
    competition,
    instruction,
    compute,
    maxIterations,
    dryRun,
    target: "local",
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

async function resolveLatestCodexSessionId(
  store: JobStore,
  discordChannelId: string,
  runnerId: string,
): Promise<string | undefined> {
  const jobs = await store.list();
  return findLatestCodexSessionId(jobs, discordChannelId, runnerId) ?? undefined;
}

export function findLatestCodexSessionId(
  jobs: JobRecord[],
  discordChannelId: string,
  runnerId: string,
): string | null {
  for (const job of jobs) {
    if (
      job.tool === "codex" &&
      job.target === "runner" &&
      job.discord_channel_id === discordChannelId &&
      job.runner_id === runnerId &&
      typeof job.external_id === "string" &&
      job.external_id.trim()
    ) {
      return job.external_id;
    }
  }

  return null;
}

export function shouldStartNewCodexSession(content: string): boolean {
  return shouldResetChatSession(content);
}

export function stripCodexSessionDirective(prompt: string): string {
  const trimmed = prompt.trim();
  const stripped = trimmed.replace(
    /^(?:新しいセッション(?:で|を開始して)?|セッションをリセット(?:して)?|会話をリセット(?:して)?|reset session|new session)\s*[:：]?\s*/i,
    "",
  );

  return stripped.trim() || trimmed;
}
