import { ContainerBuilder, escapeMarkdown } from "discord.js";
import { EditionStatus } from "../../minecraft/ping";
import { bullet, Card, timestamp, truncate } from "../components";
import { Colors, Emojis, Icons } from "../theme";

export type StatusViewInput = {
  name: string;
  editions: EditionStatus[];
  checkedAt: Date;
  offlineSince?: number;
  refreshSeconds?: number;
  thumbnail?: string | null;
};

const DEFAULT_JAVA_PORT = 25565;

function playerBar(online: number, max: number): string {
  if (max <= 0) return "";
  const slots = 10;
  const filled = Math.min(slots, Math.round((online / max) * slots));
  return `${"▰".repeat(filled)}${"▱".repeat(slots - filled)}`;
}

function quote(text: string): string {
  return text
    .split("\n")
    .slice(0, 3)
    .map((line) => `> ${escapeMarkdown(truncate(line, 120))}`)
    .join("\n");
}

/** How players type the address in their client. */
export function formatAddress(edition: EditionStatus["edition"], host: string, port: number): string {
  if (edition === "bedrock") return bullet(`**IP:** \`${host}\` · **Port:** \`${port}\``);
  return bullet(port === DEFAULT_JAVA_PORT ? `**IP:** \`${host}\`` : `**IP:** \`${host}:${port}\``);
}

function editionBlock(status: EditionStatus): string {
  const { ping } = status;
  const title =
    status.edition === "bedrock" ? `${Icons.bedrock} **Bedrock Edition**` : `${Icons.java} **Java Edition**`;

  const state = ping.online
    ? [`${Icons.online} Online`, `\`${ping.latencyMs} ms\``, ping.version ? escapeMarkdown(truncate(ping.version, 40)) : null]
        .filter(Boolean)
        .join(" · ")
    : `${Icons.offline} Offline`;

  return `${title} — ${state}\n${formatAddress(status.edition, status.host, status.port)}`;
}

export function statusView(input: StatusViewInput): ContainerBuilder {
  const online = input.editions.filter((status) => status.ping.online);
  const allOnline = online.length === input.editions.length;
  const lead = online[0]?.ping;

  const footer = input.refreshSeconds
    ? `Refreshes every ${input.refreshSeconds}s · Last checked ${timestamp(input.checkedAt)}`
    : `Checked ${timestamp(input.checkedAt)}`;

  let color: number = Colors.success;
  let subtitle: string;

  if (!lead?.online) {
    color = Colors.danger;
    subtitle = input.offlineSince
      ? `${Icons.offline} **Offline** · Unreachable since ${timestamp(input.offlineSince)}`
      : `${Icons.offline} **Offline** · The server is not responding`;
  } else {
    const players = `**${lead.playersOnline}** / ${lead.playersMax} players`;
    if (allOnline) {
      subtitle = `${Icons.online} **Online** · ${players}`;
    } else {
      color = Colors.warning;
      subtitle = `${Icons.pending} **Partially online** · ${players}`;
    }
  }

  const card = new Card(color)
    .header(`${Emojis.minecraft} ${escapeMarkdown(input.name)}`, { subtitle, thumbnail: input.thumbnail })
    .divider()
    .text(input.editions.map(editionBlock).join("\n\n"));

  if (lead?.online) {
    const bar = playerBar(lead.playersOnline, lead.playersMax);
    card.divider().fields([["Players", `\`${lead.playersOnline} / ${lead.playersMax}\`${bar ? `  ${bar}` : ""}`]]);
    if (lead.motd) card.text(quote(lead.motd));
  }

  return card.spacer().footer(footer).build();
}
