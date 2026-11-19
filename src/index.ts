import { Client, GatewayIntentBits } from "discord.js";
import { prisma } from "./config/prisma";
import { env } from "./config/env";
import serverCommand from "./commands/server";
import statusCommand from "./commands/status";
import bridgeCommand from "./commands/bridge";
import utilityCommand from "./commands/utility";
import helpCommand from "./commands/help";
import whitelistCommand from "./commands/whitelist";
import verifyCommand from "./commands/verify";
import rejectCommand from "./commands/reject";
import { registerReadyEvent } from "./events/ready";
import { registerInteractionCreateEvent } from "./events/interactionCreate";
import { registerMessageCreateEvent } from "./events/messageCreate";
import { registerMinecraftEvents } from "./events/minecraft";
import { MinecraftClient } from "./minecraft/client";
import { MinecraftBridge } from "./minecraft/bridge";
import { MinecraftStatusMonitor } from "./minecraft/status";
import { AppCommand, AppContainer } from "./types";
import { logger } from "./utils/logger";

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent]
});

const commandList: AppCommand[] = [
  serverCommand,
  statusCommand,
  bridgeCommand,
  utilityCommand,
  helpCommand,
  whitelistCommand,
  verifyCommand,
  rejectCommand
];

const commands = new Map<string, AppCommand>();
for (const command of commandList) {
  commands.set(command.name, command);
  for (const alias of command.aliases ?? []) {
    commands.set(alias, command);
  }
}

const app = {
  client,
  prisma,
  commands,
  startedAt: Date.now(),
  mcClient: new MinecraftClient()
} as AppContainer;

app.mcBridge = new MinecraftBridge(app);
app.statusMonitor = new MinecraftStatusMonitor(app);

registerReadyEvent(app);
registerInteractionCreateEvent(app);
registerMessageCreateEvent(app);
registerMinecraftEvents(app);

client.on("error", (error) => logger.error({ error }, "Discord client error"));
client.on("warn", (message) => logger.warn(message));

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", (error) => {
  logger.fatal({ error }, "Uncaught exception");
  void shutdown(1);
});

let shuttingDown = false;
async function shutdown(code = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info("Shutting down");

  app.statusMonitor.stop();
  app.mcClient.stop();
  await client.destroy().catch(() => undefined);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(code);
}

process.on("SIGINT", () => void shutdown(0));
process.on("SIGTERM", () => void shutdown(0));

client.login(env.DISCORD_TOKEN).catch((error) => {
  logger.fatal({ error }, "Failed to log in to Discord");
  void shutdown(1);
});
