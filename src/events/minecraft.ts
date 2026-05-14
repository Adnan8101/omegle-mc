import { AppContainer } from "../types";
import { logger } from "../utils/logger";

export function registerMinecraftEvents(app: AppContainer): void {
  app.mcClient.on("connected", () => {
    logger.info("Minecraft client connected");
  });

  app.mcClient.on("disconnected", () => {
    logger.warn("Minecraft client disconnected");
  });

  app.mcClient.on("chat", async (payload: { username: string; message: string }) => {
    await app.mcBridge.forwardMinecraftToDiscord(payload.username, payload.message);
  });

  app.mcClient.on("error", (error: unknown) => {
    logger.error({ error }, "Minecraft client error");
  });
}
