import { Server } from "@prisma/client";
import { GuildTextBasedChannel } from "discord.js";
import { env } from "../config/env";
import { AppContainer } from "../types";
import { v2 } from "../ui/components";
import { statusView } from "../ui/views/status";
import { logger } from "../utils/logger";
import { pingServer } from "./ping";

/** Matches the legacy embed-based status messages so they can be cleaned up once. */
const LEGACY_STATUS_TITLE = /(LIVE|OFFLINE) — /;

export class MinecraftStatusMonitor {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly inFlight = new Set<string>();
  private readonly lastOnline = new Map<string, boolean>();
  private readonly offlineSince = new Map<string, number>();

  constructor(private readonly app: AppContainer) {}

  start(): void {
    this.stop();
    void this.runOnce();
    this.timer = setInterval(() => void this.runOnce(), env.STATUS_INTERVAL_SECONDS * 1000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Refreshes every enabled status panel. Overlapping runs are skipped. */
  async runOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const servers = await this.app.prisma.server.findMany({
        where: { statusEnabled: true, statusChannelId: { not: null } }
      });
      await Promise.allSettled(servers.map((server) => this.updateServer(server)));
    } catch (error) {
      logger.error({ error }, "Status update cycle failed");
    } finally {
      this.running = false;
    }
  }

  /** Refreshes a single server's panel immediately (used after config changes). */
  async refresh(serverId: string): Promise<void> {
    const server = await this.app.prisma.server.findUnique({ where: { id: serverId } });
    if (server?.statusEnabled && server.statusChannelId) {
      await this.updateServer(server);
    }
  }

  /** Deletes a server's panel message and clears the stored reference. */
  async removePanel(server: Pick<Server, "id" | "statusChannelId" | "statusMessageId">): Promise<void> {
    if (server.statusChannelId && server.statusMessageId) {
      const channel = await this.fetchChannel(server.statusChannelId);
      const message = await channel?.messages.fetch(server.statusMessageId).catch(() => null);
      await message?.delete().catch(() => undefined);
    }

    await this.app.prisma.server
      .update({ where: { id: server.id }, data: { statusMessageId: null } })
      .catch(() => undefined);
    this.lastOnline.delete(server.id);
    this.offlineSince.delete(server.id);
  }

  private async fetchChannel(channelId: string): Promise<GuildTextBasedChannel | null> {
    const channel = await this.app.client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased() || channel.isDMBased()) return null;
    return channel;
  }

  private async updateServer(server: Server): Promise<void> {
    if (!server.statusChannelId || this.inFlight.has(server.id)) return;
    this.inFlight.add(server.id);

    try {
      const channel = await this.fetchChannel(server.statusChannelId);
      if (!channel) {
        logger.warn({ server: server.name, channelId: server.statusChannelId }, "Status channel unavailable");
        return;
      }

      const ping = await pingServer(server.host, server.port);
      const wasOnline = this.lastOnline.get(server.id);
      this.lastOnline.set(server.id, ping.online);

      if (ping.online) {
        this.offlineSince.delete(server.id);
      } else if (!this.offlineSince.has(server.id)) {
        this.offlineSince.set(server.id, Date.now());
      }

      const payload = v2([
        statusView({
          name: server.name,
          host: server.host,
          port: server.port,
          ping,
          checkedAt: new Date(),
          offlineSince: this.offlineSince.get(server.id),
          refreshSeconds: env.STATUS_INTERVAL_SECONDS,
          thumbnail: channel.guild.iconURL({ size: 128 })
        })
      ]);

      // Re-post when the server comes back online so members get a fresh unread message.
      const repost = wasOnline === false && ping.online;
      const existing = server.statusMessageId
        ? await channel.messages.fetch(server.statusMessageId).catch(() => null)
        : null;

      if (existing && !repost) {
        await existing.edit(payload);
        return;
      }

      if (existing) {
        await existing.delete().catch(() => undefined);
      } else if (!server.statusMessageId) {
        await this.cleanupLegacyMessages(channel);
      }

      const sent = await channel.send(payload);
      await this.app.prisma.server.update({ where: { id: server.id }, data: { statusMessageId: sent.id } });
    } catch (error) {
      logger.error({ error, server: server.name }, "Failed to update status panel");
    } finally {
      this.inFlight.delete(server.id);
    }
  }

  /** One-time removal of the old embed-based status messages from earlier versions. */
  private async cleanupLegacyMessages(channel: GuildTextBasedChannel): Promise<void> {
    try {
      const recent = await channel.messages.fetch({ limit: 30 });

      for (const message of recent.values()) {
        const isLegacy =
          message.author.id === this.app.client.user?.id &&
          message.embeds.some((embed) => LEGACY_STATUS_TITLE.test(embed.title ?? ""));
        if (isLegacy) await message.delete().catch(() => undefined);
      }
    } catch {
      // Missing Read Message History permission — nothing to clean.
    }
  }
}
