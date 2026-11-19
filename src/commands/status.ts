import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder, SlashCommandStringOption } from "discord.js";
import { env } from "../config/env";
import { checkServer } from "../minecraft/ping";
import { AppCommand, CommandContext } from "../types";
import { failure, success, usage } from "../ui/components";
import { serverDetailView } from "../ui/views/general";
import { statusView } from "../ui/views/status";
import { requireGuild, requirePermission, respond } from "../utils/context";
import { findServerOrReply, MESSAGE_CHANNEL_TYPES, parseChannelMention, serverAutocomplete } from "./shared";

const serverOption = (description: string) => (opt: SlashCommandStringOption) =>
  opt.setName("server").setDescription(description).setRequired(true).setAutocomplete(true);

export default {
  name: "status",
  description: "Live server status panels",
  slash: new SlashCommandBuilder()
    .setName("status")
    .setDescription("Live Minecraft server status panels")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName("enable")
        .setDescription("Post an auto-updating status panel")
        .addStringOption(serverOption("Server to monitor"))
        .addChannelOption((opt) =>
          opt.setName("channel").setDescription("Channel for the panel").setRequired(true).addChannelTypes(...MESSAGE_CHANNEL_TYPES)
        )
    )
    .addSubcommand((sub) =>
      sub.setName("disable").setDescription("Remove a status panel").addStringOption(serverOption("Server to stop monitoring"))
    )
    .addSubcommand((sub) =>
      sub.setName("check").setDescription("Ping a server right now").addStringOption(serverOption("Server to ping"))
    )
    .addSubcommand((sub) =>
      sub.setName("show").setDescription("View status panel settings").addStringOption(serverOption("Server to inspect"))
    ),

  autocomplete: serverAutocomplete,

  async execute(ctx: CommandContext) {
    const guildId = await requireGuild(ctx);
    if (!guildId || !(await requirePermission(ctx, PermissionFlagsBits.ManageGuild))) return;

    const options = ctx.interaction?.options;
    const action = options ? options.getSubcommand() : (ctx.args[0] ?? "").toLowerCase();
    const name = options ? options.getString("server", true) : ctx.args[1];

    if (!["enable", "disable", "check", "show"].includes(action) || !name) {
      await respond(ctx, usage("status enable <server> [#channel]", "status disable <server>", "status check <server>", "status show <server>"));
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

      // Moving the panel: remove the old message first.
      if (server.statusChannelId && server.statusChannelId !== channel.id) {
        await ctx.app.statusMonitor.removePanel(server);
      }

      await ctx.app.prisma.server.update({
        where: { id: server.id },
        data: { statusEnabled: true, statusChannelId: channel.id }
      });
      await ctx.app.statusMonitor.refresh(server.id);

      await respond(
        ctx,
        success("Status panel live", `**${server.name}** now has a live panel in <#${channel.id}>, refreshed every ${env.STATUS_INTERVAL_SECONDS}s.`)
      );
      return;
    }

    if (action === "disable") {
      await ctx.app.statusMonitor.removePanel(server);
      await ctx.app.prisma.server.update({ where: { id: server.id }, data: { statusEnabled: false } });
      await respond(ctx, success("Status panel removed", `Stopped monitoring **${server.name}**.`));
      return;
    }

    if (action === "check") {
      const editions = await checkServer(server);
      await respond(ctx, statusView({ name: server.name, editions, checkedAt: new Date() }));
      return;
    }

    await respond(ctx, serverDetailView(server, "Status panel settings"));
  }
} satisfies AppCommand;
