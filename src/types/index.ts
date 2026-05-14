import { PrismaClient } from "@prisma/client";
import {
  ChatInputCommandInteraction,
  Client,
  Message,
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder
} from "discord.js";
import { MinecraftBridge } from "../minecraft/bridge";
import { MinecraftClient } from "../minecraft/client";
import { MinecraftStatusMonitor } from "../minecraft/status";

export type CommandSource = "slash" | "prefix";

export type CommandContext = {
  app: AppContainer;
  source: CommandSource;
  interaction?: ChatInputCommandInteraction;
  message?: Message;
  args: string[];
};

export type AppCommand = {
  name: string;
  description: string;
  aliases?: string[];
  slash?: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder;
  execute: (ctx: CommandContext) => Promise<void>;
};

export type AppContainer = {
  client: Client;
  prisma: PrismaClient;
  commands: Map<string, AppCommand>;
  startedAt: number;
  mcClient: MinecraftClient;
  mcBridge: MinecraftBridge;
  statusMonitor: MinecraftStatusMonitor;
};
