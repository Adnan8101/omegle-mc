import { EventEmitter } from "events";
import mineflayer from "mineflayer";
import { env } from "../config/env";
import { logger } from "../utils/logger";

export type ChatPayload = { username: string; message: string };
export type PlayerEventPayload = { username: string; type: "join" | "leave" };

/** Minecraft caps chat packets at 256 characters; longer messages kick the bot. */
export const MC_CHAT_LIMIT = 256;

/** Ignore join/leave spam emitted for every online player right after we log in. */
const JOIN_GRACE_MS = 5000;

/**
 * Wraps a single Mineflayer bot used for the chat bridge.
 * Emits: "connected", "disconnected", "chat" (ChatPayload), "player" (PlayerEventPayload).
 */
export class MinecraftClient extends EventEmitter {
  private bot: mineflayer.Bot | null = null;
  private reconnectIndex = 0;
  private readonly reconnectDelays = [5_000, 10_000, 30_000, 60_000];
  private readonly queue: string[] = [];
  private queueActive = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private spawnedAt = 0;
  public connected = false;

  get target(): string {
    return `${env.MC_SERVER_HOST}:${env.MC_JAVA_PORT}`;
  }

  get username(): string {
    return this.bot?.username ?? env.MC_BOT_USERNAME;
  }

  connect(): void {
    if (this.stopped) return;
    this.clearReconnectTimer();
    this.disposeBot();

    logger.info({ target: this.target, username: env.MC_BOT_USERNAME }, "Connecting Minecraft bridge bot");

    try {
      const bot = mineflayer.createBot({
        host: env.MC_SERVER_HOST,
        port: env.MC_JAVA_PORT,
        username: env.MC_BOT_USERNAME,
        auth: env.MC_BOT_AUTH,
        hideErrors: true
      });
      this.bot = bot;
      this.bindEvents(bot);
    } catch (error) {
      logger.warn({ error, target: this.target }, "Could not create Minecraft bot");
      this.handleDisconnect();
    }
  }

  /** Permanently stops the bot (used on shutdown). */
  stop(): void {
    this.stopped = true;
    this.clearReconnectTimer();
    this.disposeBot();
    this.connected = false;
  }

  sendChat(message: string): boolean {
    const trimmed = message.trim();
    if (!trimmed) return false;
    if (!this.connected) return false;

    // Bound the queue so an outage can't build an unbounded backlog.
    if (this.queue.length >= 50) this.queue.shift();
    this.queue.push(trimmed.slice(0, MC_CHAT_LIMIT));
    this.processQueue();
    return true;
  }

  private bindEvents(bot: mineflayer.Bot): void {
    // Every handler ignores events from bots that have since been replaced.
    const current = () => this.bot === bot;

    bot.once("spawn", () => {
      if (!current()) return;
      logger.info({ username: bot.username }, "Minecraft bridge bot connected");
      this.connected = true;
      this.spawnedAt = Date.now();
      this.reconnectIndex = 0;
      this.emit("connected");
    });

    bot.on("chat", (username, message) => {
      if (!current() || username === bot.username) return;
      if (!message?.trim()) return;
      this.emit("chat", { username, message } satisfies ChatPayload);
    });

    bot.on("playerJoined", (player) => {
      if (!current() || !this.connected || player.username === bot.username) return;
      if (Date.now() - this.spawnedAt < JOIN_GRACE_MS) return;
      this.emit("player", { username: player.username, type: "join" } satisfies PlayerEventPayload);
    });

    bot.on("playerLeft", (player) => {
      if (!current() || !this.connected || player.username === bot.username) return;
      this.emit("player", { username: player.username, type: "leave" } satisfies PlayerEventPayload);
    });

    bot.on("kicked", (reason) => {
      if (!current()) return;
      logger.warn({ reason }, "Minecraft bridge bot was kicked");
    });

    bot.on("error", (error) => {
      if (!current()) return;
      logger.warn({ error: error?.message ?? String(error) }, "Minecraft bridge bot error");
      // "end" usually follows; if the socket never opened it may not, so schedule defensively.
      this.handleDisconnect();
    });

    bot.on("end", (reason) => {
      if (!current()) return;
      logger.warn({ reason }, "Minecraft bridge bot disconnected");
      this.handleDisconnect();
    });
  }

  private processQueue(): void {
    if (this.queueActive) return;
    this.queueActive = true;

    const run = () => {
      const next = this.queue.shift();
      if (!next || !this.bot || !this.connected) {
        this.queueActive = false;
        return;
      }

      try {
        this.bot.chat(next);
      } catch (error) {
        logger.error({ error }, "Failed to send chat to Minecraft");
      }

      // Space messages out to stay under server spam filters.
      setTimeout(run, 800);
    };

    run();
  }

  private handleDisconnect(): void {
    if (this.connected) {
      this.connected = false;
      this.emit("disconnected");
    }
    this.queue.length = 0;
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;

    const delay = this.reconnectDelays[Math.min(this.reconnectIndex, this.reconnectDelays.length - 1)];
    this.reconnectIndex += 1;
    logger.info({ delayMs: delay }, "Scheduling Minecraft bridge reconnect");

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private disposeBot(): void {
    const bot = this.bot;
    this.bot = null;
    if (!bot) return;

    bot.removeAllListeners();
    bot.on("error", () => undefined); // swallow late socket errors from the old instance
    try {
      bot.quit();
    } catch {
      // already closed
    }
  }
}
