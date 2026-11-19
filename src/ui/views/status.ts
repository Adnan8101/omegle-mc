import { ContainerBuilder, escapeMarkdown } from "discord.js";
import { EditionStatus } from "../../minecraft/ping";
import { Card, timestamp, truncate } from "../components";
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

/** The address exactly as a player types it into their client. */
function address(status: EditionStatus): string {
  if (status.edition === "bedrock") return `\`${status.host}\` port \`${status.port}\``;
  return status.port === DEFAULT_JAVA_PORT ? `\`${status.host}\`` : `\`${status.host}:${status.port}\``;
}

function connectLine(status: EditionStatus, showState: boolean): string {
  const label = status.edition === "bedrock" ? "Bedrock" : "Java";
  const state = showState && !status.ping.online ? " — offline" : "";
  return `**${label}** ${address(status)}${state}`;
}

export function statusView(input: StatusViewInput): ContainerBuilder {
  const online = input.editions.filter((status) => status.ping.online);
  const lead = online[0]?.ping;
  const partial = online.length > 0 && online.length < input.editions.length;

  let headline: string;
  let color: number;

  if (lead?.online) {
    headline = `${Icons.online} **Online** · ${lead.playersOnline}/${lead.playersMax} players`;
    color = partial ? Colors.warning : Colors.success;
  } else {
    headline = input.offlineSince
      ? `${Icons.offline} **Offline** since ${timestamp(input.offlineSince)}`
      : `${Icons.offline} **Offline**`;
    color = Colors.danger;
  }

  const motd = lead?.online && lead.motd ? escapeMarkdown(truncate(lead.motd.split("\n")[0], 80)) : null;

  return new Card(color)
    .header(`${Emojis.minecraft} ${escapeMarkdown(input.name)}`, { subtitle: headline, thumbnail: input.thumbnail })
    .divider()
    .text(...input.editions.map((status) => connectLine(status, input.editions.length > 1 && Boolean(lead?.online))))
    .footer(motd, `Updated ${timestamp(input.checkedAt)}`)
    .build();
}
