import { Events, Message } from "discord.js";
import { env } from "../config/env";
import { AppContainer } from "../types";
import { failure, v2 } from "../ui/components";
import { logger } from "../utils/logger";

/** Splits on whitespace but keeps "quoted text" together, e.g. server add "Omegle MC" host. */
function splitArgs(input: string): string[] {
  return [...input.matchAll(/"([^"]*)"|(\S+)/g)].map((match) => match[1] ?? match[2]);
}

const utilityAliases = new Set(["ping", "uptime"]);

async function handlePrefixCommand(app: AppContainer, message: Message): Promise<boolean> {
  const withoutPrefix = message.content.slice(env.PREFIX.length).trim();
  if (!withoutPrefix) return false;

  const parts = splitArgs(withoutPrefix);
  const commandName = (parts[0] ?? "").toLowerCase();
  const command = app.commands.get(commandName);
  if (!command) return false;

  const args =
    command.name === "utility" && utilityAliases.has(commandName)
      ? [commandName, ...parts.slice(1)]
      : parts.slice(1);

  try {
    await command.execute({ app, source: "prefix", message, args });
  } catch (error) {
    logger.error({ error, command: commandName }, "Prefix command failed");
    await message.reply(v2([failure("Something went wrong while running that command.")])).catch(() => undefined);
  }
  return true;
}

export function registerMessageCreateEvent(app: AppContainer): void {
  app.client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.inGuild()) return;

    try {
      if (message.content.startsWith(env.PREFIX) && (await handlePrefixCommand(app, message))) return;
      await app.mcBridge.forwardDiscordToMinecraft(message);
    } catch (error) {
      logger.error({ error }, "Message handler failed");
    }
  });
}
