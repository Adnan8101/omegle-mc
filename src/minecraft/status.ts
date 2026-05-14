import { Message, TextChannel } from "discord.js";
import { AppContainer } from "../types";
import { statusEmbed } from "../utils/embeds";
import { logger } from "../utils/logger";

let bedrockProtocol: any = null;

try {
  bedrockProtocol = require("bedrock-protocol");
} catch {
  bedrockProtocol = null;
}

type PingData = {
  online: boolean;
  pingMs?: number;
  playersOnline?: number;
  playersMax?: number;
  motd?: string;
};

function formatMotd(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "A Minecraft Server";

  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node) return;
    if (typeof node === "string") {
      parts.push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (typeof record.text === "string") parts.push(record.text);
      if (Array.isArray(record.extra)) walk(record.extra);
      if (Array.isArray(record.with)) walk(record.with);
    }
  };

  walk(value);
  return parts.join(" ").replace(/\s+/g, " ").trim() || "A Minecraft Server";
}

export class MinecraftStatusMonitor {
  private timer: NodeJS.Timeout | null = null;
  private readonly messageMap = new Map<string, string>();
  private readonly onlineStateMap = new Map<string, boolean>();

  constructor(private readonly app: AppContainer) {}

  start(): void {
    if (this.timer) clearInterval(this.timer);

    this.runOnce().catch((error) => {
      logger.error({ error }, "Initial status update failed");
    });

    this.timer = setInterval(() => {
      this.runOnce().catch((error) => {
        logger.error({ error }, "Scheduled status update failed");
      });
    }, 5000);
  }

  async runOnce(): Promise<void> {
    const servers = await this.app.prisma.server.findMany({
      where: {
        statusEnabled: true,
        statusChannelId: { not: null }
      }
    });

    for (const server of servers) {
      if (!server.statusChannelId) continue;

      const channel = await this.app.client.channels.fetch(server.statusChannelId).catch(() => null);
      if (!channel || !channel.isTextBased()) continue;

      const ping = await this.pingServer(server.host, server.port);

      const previousState = this.onlineStateMap.get(server.id);
      const isOnline = ping.online;
      this.onlineStateMap.set(server.id, isOnline);
      
      const justReconnected = previousState === false && isOnline === true;

      const embed = statusEmbed({
        name: server.name,
        online: ping.online,
        host: server.host,
        port: server.port,
        pingMs: ping.pingMs,
        playersOnline: ping.playersOnline,
        playersMax: ping.playersMax,
        motd: ping.motd
      });

      await this.upsertStatusMessage(server.id, channel as TextChannel, embed, justReconnected);
    }
  }

  private async upsertStatusMessage(serverId: string, channel: TextChannel, embed: any, forceNew: boolean = false): Promise<void> {
    const existingMessageId = this.messageMap.get(serverId);

    if (existingMessageId) {
      const existing = await channel.messages.fetch(existingMessageId).catch(() => null);
      if (existing) {
        if (forceNew) {
          await existing.delete().catch(() => null);
          this.messageMap.delete(serverId);
        } else {
          await existing.edit({ embeds: [embed] });
          return;
        }
      }
    } 
    
    if (!this.messageMap.has(serverId)) {
      // First time running after restart or forced new message: clean up old bot messages
      try {
        const messages = await channel.messages.fetch({ limit: 30 });
        const oldMessages = messages.filter(m => m.author.id === this.app.client.user?.id);
        for (const [id, msg] of oldMessages) {
          await msg.delete().catch(() => null);
        }
      } catch (error) {
        // ignore if we lack permissions
      }
    }

    const sent: Message = await channel.send({ embeds: [embed] });
    this.messageMap.set(serverId, sent.id);
  }

  private async pingServer(host: string, port: number): Promise<PingData> {
    try {
      const minecraftProtocol = require("minecraft-protocol");
      const started = Date.now();

      const javaPing = await new Promise<any>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Ping timed out"));
        }, 8000);

        minecraftProtocol.ping({ host, port }, (error: unknown, data: any) => {
          clearTimeout(timeout);
          if (error) {
            reject(error);
            return;
          }
          resolve(data);
        });
      });

      const elapsed = Date.now() - started;

      const playersOnline = Number(javaPing?.players?.online ?? 0);
      const playersMax = Number(javaPing?.players?.max ?? 0);
      const motd = formatMotd(javaPing?.description ?? javaPing?.motd ?? "A Minecraft Server");

      return {
        online: true,
        pingMs: elapsed,
        playersOnline,
        playersMax,
        motd
      };
    } catch (javaError) {
      try {
        const { Client } = require("jsp-raknet");
        const client = new Client(host, port);

        const started = Date.now();

        const serverName = await new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => {
            client.close();
            reject(new Error("Ping timed out"));
          }, 8000);

          client.ping((name: string) => {
            clearTimeout(timeout);
            client.close();
            resolve(name);
          });
        });

        const elapsed = Date.now() - started;
        const response = bedrockProtocol?.ServerAdvertisement?.fromServerName?.(serverName);
        const parts = serverName.split(";");

        const playersOnline = Number(response?.playersOnline ?? response?.players?.online ?? parts[4] ?? 0);
        const playersMax = Number(response?.playersMax ?? response?.players?.max ?? parts[5] ?? 0);
        const motdRaw = response?.motd ?? response?.description ?? parts[1] ?? "A Minecraft Server";
        const motd = Array.isArray(motdRaw) ? motdRaw.join(" ") : String(motdRaw);

        return {
          online: true,
          pingMs: elapsed,
          playersOnline,
          playersMax,
          motd
        };
      } catch {
        logger.debug({ host, port, javaError }, "Status ping failed for both Java and Bedrock");
        return { online: false };
      }
    }
  }
}
