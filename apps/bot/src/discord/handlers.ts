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
import { formatJobList, formatJobStarted } from "./ui.js";

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
    case "job-run": {
      const prompt = interaction.options.getString("prompt", true);
      const job = await store.create({
        prompt,
        status: "queued",
        target: "local",
      });

      void store
        .update(job.id, { status: "running" })
        .then(() => codex.run({ ...job, status: "running" }))
        .then(async (result) => {
          await store.update(job.id, {
            status: result.status,
            summary: result.summary,
            finishedAt: result.finishedAt,
          });
        })
        .catch(async (error) => {
          await store.update(job.id, {
            status: "failed",
            summary: error instanceof Error ? error.message : "job failed",
            finishedAt: new Date().toISOString(),
          });
        });

      return formatJobStarted(job);
    }
    case "job-list": {
      const jobs = await store.list();
      return formatJobList(jobs);
    }
    default:
      return {
        content: "未対応のコマンドです。",
        flags: MessageFlags.Ephemeral,
      };
  }
}
