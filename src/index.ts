import {
  Client,
  GatewayIntentBits,
  Partials
} from "discord.js";
import { prisma } from "./config/prisma";
import { env } from "./config/env";
import serverCommand from "./commands/server";
import statusCommand from "./commands/status";
import bridgeCommand from "./commands/bridge";
import utilityCommand from "./commands/utility";
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
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

const commandList: AppCommand[] = [
  serverCommand,
  statusCommand,
  bridgeCommand,
  utilityCommand
];

const commands = new Map<string, AppCommand>();
for (const command of commandList) {
  commands.set(command.name, command);

  for (const alias of command.aliases || []) {
    commands.set(alias, command);
  }
}

const app: AppContainer = {
  client,
  prisma,
  commands,
  startedAt: Date.now(),
  mcClient: new MinecraftClient(),
  mcBridge: undefined as unknown as MinecraftBridge,
  statusMonitor: undefined as unknown as MinecraftStatusMonitor
};

app.mcBridge = new MinecraftBridge(app);
app.statusMonitor = new MinecraftStatusMonitor(app);

registerReadyEvent(app);
registerInteractionCreateEvent(app);
registerMessageCreateEvent(app);
registerMinecraftEvents(app);

client.on("messageCreate", async (message) => {
  await app.mcBridge.forwardDiscordToMinecraft(message);
});

client.login(env.DISCORD_TOKEN).catch((error) => {
  logger.error({ error }, "Failed to login Discord client");
  process.exit(1);
});

process.on("SIGINT", async () => {
  logger.info("Shutting down");
  await prisma.$disconnect();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Shutting down");
  await prisma.$disconnect();
  process.exit(0);
});
