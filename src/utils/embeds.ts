import { ColorResolvable, EmbedBuilder } from "discord.js";
import { nowTime } from "./helpers";

const colors = {
  success: 0x57f287,
  error: 0xed4245,
  info: 0x5865f2,
  warning: 0xfee75c
} satisfies Record<string, ColorResolvable>;

export function successEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(colors.success)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp();
}

export function errorEmbed(description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(colors.error)
    .setTitle("Error")
    .setDescription(description)
    .setTimestamp();
}

export type StatusPayload = {
  name: string;
  online: boolean;
  host: string;
  port: number;
  pingMs?: number;
  playersOnline?: number;
  playersMax?: number;
  motd?: string;
};

export function statusEmbed(data: StatusPayload): EmbedBuilder {
  const state = data.online ? "🟢 LIVE — Connected" : "🔴 OFFLINE — Unreachable";
  
  // Strip Minecraft color codes (e.g. §a, §l) from MOTD
  const cleanMotd = data.motd ? data.motd.replace(/§[0-9a-fk-or]/gi, '') : "No MOTD provided";

  return new EmbedBuilder()
    .setColor(data.online ? colors.success : colors.error)
    .setTitle(state)
    .setDescription(`**${data.name}**`)
    .addFields(
      {
        name: "Players",
        value: `\`${data.playersOnline ?? 0}/${data.playersMax ?? 0}\``,
        inline: true
      },
      {
        name: "Ping",
        value: `\`${data.pingMs ?? 0} ms\``,
        inline: true
      },
      {
        name: "\u200b",
        value: "\u200b",
        inline: true
      },
      {
        name: "IP",
        value: `\`${data.host}\``,
        inline: true
      },
      {
        name: "Port",
        value: `\`${data.port}\``,
        inline: true
      },
      {
        name: "Address",
        value: `\`${data.host}:${data.port}\``,
        inline: true
      },
      {
        name: "MOTD",
        value: `\`\`\`\n${cleanMotd}\n\`\`\``,
        inline: false
      }
    )
    .setFooter({ text: "Last Updated" })
    .setTimestamp();
}
