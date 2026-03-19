import { Client, Events, GatewayIntentBits } from "discord.js";

import { loadConfig } from "./config.js";
import { startDashboardServer } from "./dashboard.js";
import { attachInteractionHandlers } from "./discord/handlers.js";
import { createJobService } from "./jobs/service.js";
import { createJobStore } from "./jobs/store.js";
import { loadCodexTargets } from "./targets.js";
import { createLogger } from "./util/logger.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const targets = loadCodexTargets(config.targetsConfigPath);
  const store = createJobStore(config.jobDataDir);
  const jobs = createJobService(
    store,
    config.logDir,
    logger,
    {
      codexBin: config.codexBin,
      workspaceRoot: config.workspaceRoot,
      sourceRepo: config.workspaceSourceRepo,
      fullAuto: config.codexFullAuto,
      sandbox: config.codexSandbox,
      bridgeAuthToken: config.runnerBridgeAuthToken,
      targets,
    },
    {
      autopilotBin: config.autopilotBin,
      workdir: config.autopilotWorkdir ?? config.workspaceSourceRepo,
      artifactsDir: config.autopilotArtifactsDir,
      pollIntervalMs: config.autopilotPollIntervalMs,
    },
    {
      workdir: config.chatCommandsWorkdir,
    },
  );

  const intents = [GatewayIntentBits.Guilds];

  if (config.chatCommandsEnabled) {
    intents.push(
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    );
  }

  const client = new Client({ intents });

  attachInteractionHandlers(client, config, logger, store, jobs, targets);
  startDashboardServer(
    config.dashboardPort,
    config.dashboardHost,
    jobs,
    logger,
  );

  client.once(Events.ClientReady, (readyClient) => {
    logger.info(`Bot ready as ${readyClient.user.tag}`);
  });

  await client.login(config.discordToken);
}

main().catch((error) => {
  if (
    error instanceof Error &&
    error.message.includes("Used disallowed intents")
  ) {
    console.error(
      [
        "Discord Message Content Intent is not enabled for this bot.",
        "Either enable Message Content Intent in the Discord Developer Portal,",
        "or set CHAT_COMMANDS_ENABLED=false in apps/bot/.env and restart.",
      ].join(" "),
    );
  } else {
    console.error(error);
  }
  process.exitCode = 1;
});
