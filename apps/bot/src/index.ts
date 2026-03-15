import { Client, Events, GatewayIntentBits } from "discord.js";

import { loadConfig } from "./config.js";
import { attachInteractionHandlers } from "./discord/handlers.js";
import { createLogger } from "./util/logger.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  attachInteractionHandlers(client, config, logger);

  client.once(Events.ClientReady, (readyClient) => {
    logger.info(`Bot ready as ${readyClient.user.tag}`);
  });

  await client.login(config.discordToken);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

