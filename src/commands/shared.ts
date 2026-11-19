import { Server } from "@prisma/client";
import { AutocompleteInteraction, ChannelType } from "discord.js";
import { AppContainer, CommandContext } from "../types";
import { failure } from "../ui/components";
import { respond } from "../utils/context";

export const SERVER_NAME_PATTERN = /^[\w.-]{1,32}$/;
const HOST_PATTERN = /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*$/;

/** Channel types a bot message can be posted in. */
export const MESSAGE_CHANNEL_TYPES = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

export function isValidHost(host: string): boolean {
  return HOST_PATTERN.test(host);
}

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

export function parseChannelMention(token: string | undefined): string | null {
  return token?.match(/^<#(\d+)>$/)?.[1] ?? null;
}

export function parseUserMention(token: string | undefined): string | null {
  return token?.match(/^<@!?(\d+)>$/)?.[1] ?? null;
}

export function parseRoleMention(token: string | undefined): string | null {
  return token?.match(/^<@&(\d+)>$/)?.[1] ?? null;
}

/** Case-insensitive server lookup that replies with an error when nothing matches. */
export async function findServerOrReply(ctx: CommandContext, guildId: string, name: string): Promise<Server | null> {
  const server = await ctx.app.prisma.server.findFirst({
    where: { guildId, name: { equals: name, mode: "insensitive" } }
  });

  if (!server) {
    await respond(
      ctx,
      failure(`No server named **${name}** is configured. Use \`/server list\` to see your servers.`, "Server not found")
    );
  }
  return server;
}

/** Autocompletes server names for any option named `server` or `name`. */
export async function serverAutocomplete(interaction: AutocompleteInteraction, app: AppContainer): Promise<void> {
  if (!interaction.guildId) {
    await interaction.respond([]);
    return;
  }

  const query = String(interaction.options.getFocused()).toLowerCase();
  const servers = await app.prisma.server.findMany({
    where: { guildId: interaction.guildId },
    select: { name: true, host: true, port: true },
    orderBy: { name: "asc" }
  });

  await interaction.respond(
    servers
      .filter((server) => server.name.toLowerCase().includes(query))
      .slice(0, 25)
      .map((server) => ({ name: `${server.name} — ${server.host}:${server.port}`.slice(0, 100), value: server.name }))
  );
}
