import { EventEmitter } from "events";
import mineflayer from "mineflayer";
import { lookup } from "dns/promises";
import { env } from "../config/env";
import { logger } from "../utils/logger";

type ChatPayload = {
  username: string;
  message: string;
};

export class MinecraftClient extends EventEmitter {
  private client: mineflayer.Bot | null = null;
  private reconnectIndex = 0;
  private readonly reconnectDelays = [1000, 2000, 5000, 10000, 30000];
  private readonly queue: string[] = [];
  private queueActive = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  public connected = false;

  async connect(): Promise<void> {
    this.clearReconnectTimer();

    try {
      await lookup(env.MC_SERVER_HOST);

      logger.info(`Connecting Mineflayer to ${env.MC_SERVER_HOST}:${env.MC_JAVA_PORT} as ${env.MC_BOT_USERNAME}...`);
      
      this.client = mineflayer.createBot({
        host: env.MC_SERVER_HOST,
        port: env.MC_JAVA_PORT,
        username: env.MC_BOT_USERNAME,
        auth: "offline" // Assuming cracked/offline since Geyser is used
      });

      this.bindClientEvents();
    } catch (error) {
      logger.warn({ error, host: env.MC_SERVER_HOST, port: env.MC_JAVA_PORT }, "Skipping Minecraft connection");
      this.handleDisconnect(error);
    }
  }

  sendChat(message: string): void {
    if (!message || message.trim().length === 0) return;
    this.queue.push(message.trim());
    this.processQueue();
  }

  private bindClientEvents(): void {
    if (!this.client) return;

    this.client.on("spawn", () => {
      logger.info({ username: env.MC_BOT_USERNAME }, "Minecraft client spawned and is connected!");
      this.connected = true;
      this.reconnectIndex = 0;
      this.emit("connected");
    });

    this.client.on("chat", (username, message) => {
      if (username === this.client?.username) return; // Ignore our own messages
      if (!message || message.trim().length === 0) return;

      logger.debug({ username, message }, "Received chat from Minecraft");

      const payload: ChatPayload = { username, message };
      this.emit("chat", payload);
    });

    this.client.on("end", (reason) => {
      logger.warn({ reason }, "Minecraft client ended/disconnected");
      this.handleDisconnect(reason);
    });

    this.client.on("kicked", (reason) => {
      logger.warn({ reason }, "Minecraft client was kicked");
      this.handleDisconnect(reason);
    });

    this.client.on("error", (error: any) => {
      logger.error({ 
        errorMessage: error?.message || error, 
        stack: error?.stack 
      }, "Minecraft client encountered an error");
      this.handleDisconnect(error);
    });
  }

  private processQueue(): void {
    if (this.queueActive) return;
    if (this.queue.length === 0) return;

    this.queueActive = true;

    const run = () => {
      const next = this.queue.shift();
      if (!next) {
        this.queueActive = false;
        return;
      }

      this.writeChat(next);

      setTimeout(() => {
        if (this.queue.length > 0) {
          run();
          return;
        }
        this.queueActive = false;
      }, 800);
    };

    run();
  }

  private writeChat(message: string): void {
    if (!this.client || !this.connected) {
      logger.warn({ connected: this.connected }, "Dropped chat message because Minecraft client is not connected");
      return;
    }

    try {
      logger.info({ message }, "Sending chat to Minecraft");
      this.client.chat(message);
    } catch (error) {
      logger.error({ error }, "Failed to send chat to Minecraft");
      this.emit("error", error);
    }
  }

  private handleDisconnect(reason: unknown): void {
    const wasConnected = this.connected;

    if (wasConnected) {
      this.connected = false;
      this.emit("disconnected");
    }

    if (wasConnected && reason) {
      logger.warn({ reason }, "Minecraft connection lost");
    }

    // prevent multiple timers
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    this.clearReconnectTimer();

    const delay = this.reconnectDelays[Math.min(this.reconnectIndex, this.reconnectDelays.length - 1)];
    this.reconnectIndex += 1;

    this.reconnectTimer = setTimeout(async () => {
      logger.info({ delay }, "Reconnecting Minecraft client");
      await this.connect();
    }, delay);
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}
