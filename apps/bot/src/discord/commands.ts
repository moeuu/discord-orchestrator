import { SlashCommandBuilder } from "discord.js";

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Bot の疎通確認をします"),
  new SlashCommandBuilder()
    .setName("job-run")
    .setDescription("Codex ジョブを登録します")
    .addStringOption((option) =>
      option
        .setName("prompt")
        .setDescription("Codex に渡す指示")
        .setRequired(true),
    ),
  new SlashCommandBuilder()
    .setName("job-list")
    .setDescription("直近のジョブ一覧を表示します"),
].map((command) => command.toJSON());

