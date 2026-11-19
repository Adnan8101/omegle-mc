import { ActivityType, Client, Events } from "discord.js";
import { env } from "../config/env";
import { AppContainer } from "../types";
import { logger } from "../utils/logger";

export function registerReadyEvent(app: AppContainer): void {
  app.client.once(Events.ClientReady, async (client: Client<true>) => {
    logger.info({ user: client.user.tag, guilds: client.guilds.cache.size }, "Discord client is ready");

    client.user.setPresence({
      activities: [{ name: "Minecraft servers", type: ActivityType.Watching }]
    });

    const slashCommands = [...new Set(app.commands.values())]
      .filter((command) => command.slash)
      .map((command) => command.slash!.toJSON());

    try {
      await client.application.commands.set(slashCommands);
      logger.info({ count: slashCommands.length }, "Slash commands registered");
    } catch (error) {
      logger.error({ error }, "Failed to register slash commands");
    }

    app.statusMonitor.start();

    if (env.MC_BRIDGE_ENABLED) {
      app.mcClient.connect();
    } else {
      logger.info("Minecraft chat bridge disabled (MC_BRIDGE_ENABLED=false)");
    }
  });
}
