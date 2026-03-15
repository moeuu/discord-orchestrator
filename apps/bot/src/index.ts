import { Client, Events, GatewayIntentBits } from "discord.js";

import { loadConfig } from "./config.js";
import { startDashboardServer } from "./dashboard.js";
import { attachInteractionHandlers } from "./discord/handlers.js";
import { createJobService } from "./jobs/service.js";
import { createJobStore } from "./jobs/store.js";
import { createLogger } from "./util/logger.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
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

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
  });

  attachInteractionHandlers(client, config, logger, store, jobs);
  startDashboardServer(config.dashboardPort, jobs, logger);

  client.once(Events.ClientReady, (readyClient) => {
    logger.info(`Bot ready as ${readyClient.user.tag}`);
  });

  await client.login(config.discordToken);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
