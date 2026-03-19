import { loadBridgeConfig } from "./config.js";
import { startBridgeServer } from "./server.js";
import { loadCodexTargets } from "../targets.js";
import { createLogger } from "../util/logger.js";

async function main(): Promise<void> {
  const config = loadBridgeConfig();
  const logger = createLogger(config.logLevel);
  const targets = loadCodexTargets(config.targetsConfigPath);

  startBridgeServer(
    config.bindHost,
    config.port,
    {
      authToken: config.authToken,
      targets,
    },
    logger,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
