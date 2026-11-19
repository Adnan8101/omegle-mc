import { ActivityType, Client, Events } from "discord.js";
import { env } from "../config/env";
import { slashCommandData } from "../commands";
import { AppContainer } from "../types";
import { logger } from "../utils/logger";

export function registerReadyEvent(app: AppContainer): void {
  app.client.once(Events.ClientReady, async (client: Client<true>) => {
    logger.info({ user: client.user.tag, guilds: client.guilds.cache.size }, "Discord client is ready");

    client.user.setPresence({
      activities: [{ name: "Minecraft servers", type: ActivityType.Watching }]
    });

    try {
      // Global registration keeps commands in sync on every deploy/restart.
      const registered = await client.application.commands.set(slashCommandData());
      logger.info({ count: registered.size }, "Slash commands registered globally");
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
