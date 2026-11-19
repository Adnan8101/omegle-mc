import { ChatPayload, PlayerEventPayload } from "../minecraft/client";
import { AppContainer } from "../types";
import { logger } from "../utils/logger";

export function registerMinecraftEvents(app: AppContainer): void {
  app.mcClient.on("connected", () => {
    logger.info({ target: app.mcClient.target }, "Chat bridge online");
  });

  app.mcClient.on("disconnected", () => {
    logger.warn({ target: app.mcClient.target }, "Chat bridge offline");
  });

  app.mcClient.on("chat", (payload: ChatPayload) => {
    app.mcBridge.forwardMinecraftToDiscord(payload.username, payload.message).catch((error) => {
      logger.error({ error }, "Failed to forward Minecraft chat");
    });
  });

  app.mcClient.on("player", (payload: PlayerEventPayload) => {
    app.mcBridge.forwardPlayerEvent(payload.username, payload.type).catch((error) => {
      logger.error({ error }, "Failed to forward player event");
    });
  });
}
