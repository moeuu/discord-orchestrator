import { REST, Routes } from "discord.js";

import { loadConfig } from "../config.js";
import { commandDefinitions } from "./commands.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const rest = new REST({ version: "10" }).setToken(config.discordToken);

  await rest.put(
    Routes.applicationGuildCommands(
      config.discordApplicationId,
      config.discordGuildId,
    ),
    { body: commandDefinitions },
  );

  console.log(`Registered ${commandDefinitions.length} commands.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

