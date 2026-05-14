import { Message, TextChannel } from "discord.js";
import { env } from "../config/env";
import { AppContainer } from "../types";
import { sanitizeBridgeText } from "../utils/helpers";
import { logger } from "../utils/logger";

export class MinecraftBridge {
  constructor(private readonly app: AppContainer) {}

  async forwardDiscordToMinecraft(message: Message): Promise<void> {
    if (message.author.bot) return;
    if (!message.guildId) return;
    if (message.content.startsWith(env.PREFIX)) return;

    let server;

    try {
      server = await this.app.prisma.server.findFirst({
        where: {
          guildId: message.guildId,
          bridgeEnabled: true,
          bridgeChannelId: message.channelId
        }
      });
    } catch (error) {
      logger.error({ error }, "Error fetching server for bridge check");
      return;
    }

    if (!server) {
      logger.debug({ channelId: message.channelId }, "Ignored Discord message (not a bridge channel or bridge disabled)");
      return;
    }

    const content = sanitizeBridgeText(message.content);
    if (!content) return;

    const outgoing = `[DC] ${message.author.username}: ${content}`;
    logger.info({ author: message.author.username, content }, "Forwarding Discord message to Minecraft");
    this.app.mcClient.sendChat(outgoing);
  }

  async forwardMinecraftToDiscord(username: string, message: string): Promise<void> {
    const clean = sanitizeBridgeText(message);
    if (!clean) return;

    let servers: Awaited<ReturnType<typeof this.app.prisma.server.findMany>>;

    try {
      servers = await this.app.prisma.server.findMany({
        where: {
          bridgeEnabled: true,
          bridgeChannelId: { not: null }
        }
      });
    } catch (error) {
      logger.error({ error }, "Error fetching servers for Minecraft to Discord bridge");
      return;
    }
    
    if (servers.length === 0) {
      logger.debug("No servers configured for bridging Minecraft to Discord");
      return;
    }

    const payload = `🟢 [MC] ${username}: ${clean}`;
    logger.info({ username, message: clean, serversCount: servers.length }, "Forwarding Minecraft message to Discord");

    for (const server of servers) {
      if (!server.bridgeChannelId) continue;

      const channel = await this.app.client.channels.fetch(server.bridgeChannelId).catch(() => null);
      if (!channel || !channel.isTextBased()) continue;

      await (channel as TextChannel).send(payload).catch((e) => {
        logger.error({ error: e.message, channelId: server.bridgeChannelId }, "Failed to send message to Discord channel");
      });
    }
  }
}
