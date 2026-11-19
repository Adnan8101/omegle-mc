import { escapeMarkdown, Message } from "discord.js";
import { env } from "../config/env";
import { AppContainer } from "../types";
import { NO_MENTIONS, truncate } from "../ui/components";
import { logger } from "../utils/logger";
import { MC_CHAT_LIMIT } from "./client";

/** Strips § colour codes, control characters and newlines so text is safe for Minecraft chat. */
function toMinecraftText(input: string): string {
  return input
    .replace(/§./g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Escapes Discord markdown and strips § codes from Minecraft text. */
function toDiscordText(input: string, max = 1800): string {
  return escapeMarkdown(truncate(input.replace(/§./g, "").trim(), max));
}

export class MinecraftBridge {
  constructor(private readonly app: AppContainer) {}

  async forwardDiscordToMinecraft(message: Message): Promise<void> {
    if (!env.MC_BRIDGE_ENABLED) return;
    if (message.author.bot || message.webhookId || !message.guildId) return;

    const server = await this.app.prisma.server
      .findFirst({
        where: { guildId: message.guildId, bridgeEnabled: true, bridgeChannelId: message.channelId },
        select: { id: true }
      })
      .catch((error) => {
        logger.error({ error }, "Bridge lookup failed");
        return null;
      });
    if (!server) return;

    let text = toMinecraftText(message.cleanContent);
    if (message.attachments.size > 0) {
      text = `${text} [${message.attachments.size} attachment${message.attachments.size > 1 ? "s" : ""}]`.trim();
    }
    if (message.stickers.size > 0 && !text) text = "[sticker]";
    if (!text) return;

    const name = toMinecraftText(message.member?.displayName ?? message.author.username) || message.author.username;
    const prefix = `[Discord] ${name}: `;
    const outgoing = prefix + truncate(text, MC_CHAT_LIMIT - prefix.length);

    if (!this.app.mcClient.sendChat(outgoing)) {
      logger.debug({ channelId: message.channelId }, "Bridge offline — Discord message not delivered");
    }
  }

  async forwardMinecraftToDiscord(username: string, message: string): Promise<void> {
    const text = toDiscordText(message);
    if (!text) return;
    await this.broadcast(`**${toDiscordText(username, 32)}** » ${text}`);
  }

  async forwardPlayerEvent(username: string, type: "join" | "leave"): Promise<void> {
    const verb = type === "join" ? "joined" : "left";
    const icon = type === "join" ? "🟢" : "🔴";
    await this.broadcast(`-# ${icon} **${toDiscordText(username, 32)}** ${verb} the server`);
  }

  /** Sends plain text to every enabled bridge channel. Mentions never ping. */
  private async broadcast(content: string): Promise<void> {
    const servers = await this.app.prisma.server
      .findMany({ where: { bridgeEnabled: true, bridgeChannelId: { not: null } }, select: { bridgeChannelId: true } })
      .catch((error) => {
        logger.error({ error }, "Bridge channel lookup failed");
        return [];
      });

    const channelIds = new Set(servers.map((server) => server.bridgeChannelId!));

    await Promise.allSettled(
      [...channelIds].map(async (channelId) => {
        const channel = await this.app.client.channels.fetch(channelId).catch(() => null);
        if (!channel?.isSendable()) return;
        await channel.send({ content, allowedMentions: NO_MENTIONS }).catch((error: Error) => {
          logger.warn({ error: error.message, channelId }, "Failed to relay Minecraft message");
        });
      })
    );
  }
}
