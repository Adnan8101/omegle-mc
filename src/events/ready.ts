import { AppContainer } from "../types";
import { logger } from "../utils/logger";

export function registerReadyEvent(app: AppContainer): void {
  app.client.once("clientReady", async () => {
    logger.info({ user: app.client.user?.tag }, "Discord client is ready");

    const slashCommands = Array.from(new Set(app.commands.values()))
      .filter((command) => command.slash)
      .map((command) => command.slash!.toJSON());

    if (app.client.application) {
      await app.client.application.commands.set(slashCommands);
      logger.info({ count: slashCommands.length }, "Slash commands registered");
    }

    app.statusMonitor.start();
  });
}
