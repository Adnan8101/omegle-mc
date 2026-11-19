import { ContainerBuilder, escapeMarkdown } from "discord.js";
import { PingResult } from "../../minecraft/ping";
import { Card, timestamp, truncate } from "../components";
import { Colors, Icons } from "../theme";

export type StatusViewInput = {
  name: string;
  host: string;
  port: number;
  ping: PingResult;
  checkedAt: Date;
  offlineSince?: number;
  refreshSeconds?: number;
  thumbnail?: string | null;
};

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

export function statusView(input: StatusViewInput): ContainerBuilder {
  const { ping } = input;
  const address = `\`${input.host}:${input.port}\``;
  const footer = input.refreshSeconds
    ? `Refreshes every ${input.refreshSeconds}s · Last checked ${timestamp(input.checkedAt)}`
    : `Checked ${timestamp(input.checkedAt)}`;

  if (!ping.online) {
    return new Card(Colors.danger)
      .header(`${Icons.offline} ${escapeMarkdown(input.name)}`, {
        subtitle: input.offlineSince
          ? `**Offline** · Unreachable since ${timestamp(input.offlineSince)}`
          : "**Offline** · The server is not responding",
        thumbnail: input.thumbnail
      })
      .divider()
      .fields([["Address", address]])
      .spacer()
      .footer(footer)
      .build();
  }

  const edition = ping.edition === "bedrock" ? `${Icons.bedrock} Bedrock` : `${Icons.java} Java`;
  const version = ping.version ? ` ${escapeMarkdown(truncate(ping.version, 40))}` : "";
  const bar = playerBar(ping.playersOnline, ping.playersMax);

  const card = new Card(Colors.success)
    .header(`${Icons.online} ${escapeMarkdown(input.name)}`, {
      subtitle: `**Online** · ${edition}${version}`,
      thumbnail: input.thumbnail
    })
    .divider()
    .fields([
      ["Players", `\`${ping.playersOnline} / ${ping.playersMax}\`${bar ? `  ${bar}` : ""}`],
      ["Latency", `\`${ping.latencyMs} ms\``],
      ["Address", address]
    ]);

  if (ping.motd) {
    card.divider().text(quote(ping.motd));
  }

  return card.spacer().footer(footer).build();
}
