import type {
  ChatInputCommandInteraction,
  Client,
  InteractionReplyOptions,
} from "discord.js";
import { Events, MessageFlags } from "discord.js";

import type { AppConfig } from "../config.js";
import { createJobStore } from "../jobs/store.js";
import { createCodexExecutor } from "../jobs/codexExec.js";
import type { Logger } from "../util/logger.js";
import { buildJobStatusReply } from "./ui.js";

export function attachInteractionHandlers(
  client: Client,
  config: AppConfig,
  logger: Logger,
): void {
  const store = createJobStore(config.jobDataDir);
  const codex = createCodexExecutor(config.codexBin, logger);

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) {
      return;
    }

    try {
      const response = await handleSlashCommand(interaction, store, codex);
      await interaction.reply(response);
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
  store: ReturnType<typeof createJobStore>,
  codex: ReturnType<typeof createCodexExecutor>,
): Promise<InteractionReplyOptions> {
  switch (interaction.commandName) {
    case "ping":
      return { content: "pong" };
    case "codex":
      return await handleCodexCommand(interaction, store, codex);
    default:
      return {
        content: "未対応のコマンドです。",
        flags: MessageFlags.Ephemeral,
      };
  }
}

async function handleCodexCommand(
  interaction: ChatInputCommandInteraction,
  store: ReturnType<typeof createJobStore>,
  codex: ReturnType<typeof createCodexExecutor>,
): Promise<InteractionReplyOptions> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case "status": {
      const jobId = interaction.options.getString("job_id");
      const job = jobId ? await store.getByJobId(jobId) : await store.getLatest();
      return buildJobStatusReply(job);
    }
    case "run":
      return {
        content: "run は次のステップでダミー実装を追加します。",
        flags: MessageFlags.Ephemeral,
      };
    case "logs":
      return {
        content: "logs はまだ未実装です。",
        flags: MessageFlags.Ephemeral,
      };
    case "cancel":
      return {
        content: "cancel はまだ未実装です。",
        flags: MessageFlags.Ephemeral,
      };
    default: {
      void codex;
      return {
        content: "未対応の subcommand です。",
        flags: MessageFlags.Ephemeral,
      };
    }
  }
}
