import { SlashCommandBuilder } from "discord.js";

export const commandDefinitions = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Bot の疎通確認をします"),
  new SlashCommandBuilder()
    .setName("codex")
    .setDescription("Codex ジョブを操作します")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("run")
        .setDescription("Codex ジョブを登録します")
        .addStringOption((option) =>
          option
            .setName("prompt")
            .setDescription("Codex に渡す指示")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("target")
            .setDescription("実行ターゲット")
            .addChoices(
              { name: "local", value: "local" },
              { name: "ssh", value: "ssh" },
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("ジョブの状態を表示します")
        .addStringOption((option) =>
          option
            .setName("job_id")
            .setDescription("確認したい job_id。未指定なら最新"),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("logs")
        .setDescription("ジョブのログ情報を表示します")
        .addStringOption((option) =>
          option
            .setName("job_id")
            .setDescription("ログを見たい job_id")
            .setRequired(true),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("cancel")
        .setDescription("ジョブをキャンセルします")
        .addStringOption((option) =>
          option
            .setName("job_id")
            .setDescription("キャンセルしたい job_id")
            .setRequired(true),
        ),
    ),
].map((command) => command.toJSON());
