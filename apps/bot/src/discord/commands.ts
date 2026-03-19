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
              { name: "macbook", value: "macbook" },
              { name: "local", value: "local" },
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
  new SlashCommandBuilder()
    .setName("autopilot")
    .setDescription("Kaggle Autopilot ジョブを操作します")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("run")
        .setDescription("Kaggle Autopilot ジョブを開始します")
        .addStringOption((option) =>
          option
            .setName("competition")
            .setDescription("competition slug または URL")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("instruction")
            .setDescription("自然言語の指示")
            .setRequired(true),
        )
        .addStringOption((option) =>
          option
            .setName("compute")
            .setDescription("実行環境")
            .addChoices(
              { name: "local_gpu", value: "local_gpu" },
              { name: "kaggle_gpu", value: "kaggle_gpu" },
              { name: "kaggle_tpu", value: "kaggle_tpu" },
            ),
        )
        .addIntegerOption((option) =>
          option
            .setName("max_iterations")
            .setDescription("最大 iteration 数")
            .setMinValue(1),
        )
        .addBooleanOption((option) =>
          option
            .setName("dry_run")
            .setDescription("提出を伴わない dry-run で実行する"),
        )
        .addStringOption((option) =>
          option
            .setName("runner")
            .setDescription("実行先 runner")
            .addChoices(
              { name: "lab_rdp", value: "lab_rdp" },
              { name: "local", value: "local" },
            ),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("status")
        .setDescription("Autopilot ジョブの状態を表示します")
        .addStringOption((option) =>
          option
            .setName("job_id")
            .setDescription("確認したい job_id。未指定なら最新"),
        ),
    )
    .addSubcommand((subcommand) =>
      subcommand
        .setName("logs")
        .setDescription("Autopilot ジョブのログ情報を表示します")
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
        .setDescription("Autopilot ジョブをキャンセルします")
        .addStringOption((option) =>
          option
            .setName("job_id")
            .setDescription("キャンセルしたい job_id")
            .setRequired(true),
        ),
    ),
].map((command) => command.toJSON());
