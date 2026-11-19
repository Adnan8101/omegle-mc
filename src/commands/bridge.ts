import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { env } from "../config/env";
import { AppCommand, CommandContext } from "../types";
import { Card, failure, success, usage } from "../ui/components";
import { Colors, Emojis, Icons } from "../ui/theme";
import { requireGuild, requirePermission, respond } from "../utils/context";
import { findServerOrReply, MESSAGE_CHANNEL_TYPES, parseChannelMention, serverAutocomplete } from "./shared";

export default {
  name: "bridge",
  description: "Discord ↔ Minecraft chat bridge",
  slash: new SlashCommandBuilder()
    .setName("bridge")
    .setDescription("Relay chat between Discord and Minecraft")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName("enable")
        .setDescription("Relay chat between a channel and Minecraft")
        .addStringOption((opt) => opt.setName("server").setDescription("Server to bridge").setRequired(true).setAutocomplete(true))
        .addChannelOption((opt) =>
          opt.setName("channel").setDescription("Channel to relay").setRequired(true).addChannelTypes(...MESSAGE_CHANNEL_TYPES)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("disable")
        .setDescription("Stop relaying chat")
        .addStringOption((opt) => opt.setName("server").setDescription("Server to unbridge").setRequired(true).setAutocomplete(true))
    )
    .addSubcommand((sub) => sub.setName("info").setDescription("Show bridge connection status")),

  autocomplete: serverAutocomplete,

  async execute(ctx: CommandContext) {
    const guildId = await requireGuild(ctx);
    if (!guildId || !(await requirePermission(ctx, PermissionFlagsBits.ManageGuild))) return;

    const options = ctx.interaction?.options;
    const action = options ? options.getSubcommand() : (ctx.args[0] ?? "").toLowerCase();

    if (action === "info") {
      const bridged = await ctx.app.prisma.server.findMany({ where: { guildId, bridgeEnabled: true } });
      const mc = ctx.app.mcClient;
      const connection = !env.MC_BRIDGE_ENABLED
        ? `${Icons.disabled} Disabled (\`MC_BRIDGE_ENABLED=false\`)`
        : mc.connected
          ? `${Icons.online} Connected as \`${mc.username}\``
          : `${Icons.offline} Reconnecting…`;

      const card = new Card(mc.connected ? Colors.success : Colors.neutral)
        .header(`${Icons.bridge} Chat bridge`, { subtitle: connection })
        .divider()
        .fields([["Minecraft server", `\`${mc.target}\``]]);

      card.text(
        "**Bridged channels**",
        ...(bridged.length
          ? bridged.map((server) => `${Emojis.dot} <#${server.bridgeChannelId}> ↔ **${server.name}**`)
          : ["-# None yet — use `/bridge enable`."])
      );

      await respond(ctx, card.build());
      return;
    }

    const name = options ? options.getString("server", true) : ctx.args[1];
    if (!["enable", "disable"].includes(action) || !name) {
      await respond(ctx, usage("bridge enable <server> [#channel]", "bridge disable <server>", "bridge info"));
      return;
    }

    const server = await findServerOrReply(ctx, guildId, name);
    if (!server) return;

    if (action === "enable") {
      const channelId = options
        ? options.getChannel("channel", true).id
        : parseChannelMention(ctx.args[2]) ?? ctx.message?.channelId ?? null;

      const channel = channelId ? await ctx.app.client.channels.fetch(channelId).catch(() => null) : null;
      if (!channel || !channel.isSendable() || channel.isDMBased()) {
        await respond(ctx, failure("I can't post in that channel. Check that I can view it and send messages there.", "Channel unavailable"));
        return;
      }

      await ctx.app.prisma.server.update({
        where: { id: server.id },
        data: { bridgeEnabled: true, bridgeChannelId: channel.id }
      });

      await respond(
        ctx,
        success("Bridge enabled", [
          `Messages in <#${channel.id}> are now relayed to Minecraft, and in-game chat appears there.`,
          !env.MC_BRIDGE_ENABLED ? `${Icons.warning} The bridge connection is disabled in the bot's environment (\`MC_BRIDGE_ENABLED\`).` : null
        ])
      );
      return;
    }

    await ctx.app.prisma.server.update({ where: { id: server.id }, data: { bridgeEnabled: false } });
    await respond(ctx, success("Bridge disabled", `Chat is no longer relayed for **${server.name}**.`));
  }
} satisfies AppCommand;
