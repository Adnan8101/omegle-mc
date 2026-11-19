import { ContainerBuilder, escapeMarkdown } from "discord.js";
import { Server } from "@prisma/client";
import { Card, timestamp } from "../components";
import { Colors, Emojis, Icons } from "../theme";

/** One-line summary of a server's Java and Bedrock addresses. */
export function addressSummary(server: Server): string {
  const java = `${Icons.java} \`${server.host}:${server.port}\``;
  if (server.bedrockPort === null) return java;
  return `${java}  ${Icons.bedrock} \`${server.bedrockHost ?? server.host}\` port \`${server.bedrockPort}\``;
}

function badge(enabled: boolean, channelId: string | null): string {
  return enabled && channelId ? `${Icons.online} <#${channelId}>` : `${Icons.disabled} Off`;
}

export function serverListView(servers: Server[]): ContainerBuilder {
  const card = new Card(Colors.brand).header(`${Emojis.minecraft} Servers`, {
    subtitle: `${servers.length} server${servers.length === 1 ? "" : "s"} configured`
  });

  for (const server of servers.slice(0, 15)) {
    card
      .divider()
      .text(
        `${Emojis.dot} **${escapeMarkdown(server.name)}**`,
        addressSummary(server),
        `-# Status ${badge(server.statusEnabled, server.statusChannelId)}  ·  Bridge ${badge(server.bridgeEnabled, server.bridgeChannelId)}`
      );
  }

  if (servers.length > 15) card.spacer().footer(`Showing 15 of ${servers.length} servers.`);
  return card.build();
}

export function serverDetailView(server: Server, title: string): ContainerBuilder {
  return new Card(Colors.brand)
    .header(`${Emojis.minecraft} ${escapeMarkdown(server.name)}`, { subtitle: title })
    .divider()
    .fields([
      ["Java", `\`${server.host}:${server.port}\``],
      ["Bedrock", server.bedrockPort === null ? `${Icons.disabled} Not set` : `\`${server.bedrockHost ?? server.host}\` · Port \`${server.bedrockPort}\``],
      ["Status panel", badge(server.statusEnabled, server.statusChannelId)],
      ["Chat bridge", badge(server.bridgeEnabled, server.bridgeChannelId)],
      ["Added", timestamp(server.createdAt)]
    ])
    .build();
}

export function pingView(gatewayMs: number, roundTripMs: number | null, bridge: { enabled: boolean; connected: boolean; target: string }): ContainerBuilder {
  const bridgeState = !bridge.enabled
    ? `${Icons.disabled} Disabled`
    : bridge.connected
      ? `${Icons.online} Connected to \`${bridge.target}\``
      : `${Icons.offline} Reconnecting to \`${bridge.target}\``;

  return new Card(Colors.brand)
    .text("### 🏓 Pong!")
    .fields([
      ["Gateway", `\`${gatewayMs < 0 ? "—" : `${gatewayMs} ms`}\``],
      roundTripMs !== null ? ["Round trip", `\`${roundTripMs} ms\``] : null,
      ["Minecraft bridge", bridgeState]
    ])
    .build();
}

export function uptimeView(startedAt: number, duration: string): ContainerBuilder {
  return new Card(Colors.brand)
    .text("### ⏱️ Uptime")
    .fields([
      ["Running for", `\`${duration}\``],
      ["Online since", `${timestamp(startedAt, "f")} (${timestamp(startedAt)})`]
    ])
    .build();
}
