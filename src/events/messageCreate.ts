import { env } from "../config/env";
import { AppContainer } from "../types";
import { logger } from "../utils/logger";

const utilityAliases = new Set(["ping", "help", "uptime", "h"]);

export function registerMessageCreateEvent(app: AppContainer): void {
  app.client.on("messageCreate", async (message) => {
    if (message.author.bot) return;
    if (!message.guildId) return;
    if (!message.content.startsWith(env.PREFIX)) return;

    const withoutPrefix = message.content.slice(env.PREFIX.length).trim();
    if (!withoutPrefix) return;

    const parts = withoutPrefix.split(/\s+/);
    const commandName = parts[0]?.toLowerCase();
    const command = app.commands.get(commandName);
    if (!command) return;

    const args = command.name === "utility" && utilityAliases.has(commandName)
      ? [commandName === "h" ? "help" : commandName, ...parts.slice(1)]
      : parts.slice(1);

    try {
      await command.execute({
        app,
        source: "prefix",
        message,
        args
      });
    } catch (error) {
      logger.error({ error, command: commandName }, "Prefix command failed");
      await message.reply("Command failed.");
    }
  });
}
