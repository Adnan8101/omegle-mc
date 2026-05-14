import { MessageFlags,  SlashCommandBuilder } from "discord.js";
import { AppCommand, CommandContext } from "../types";
import { errorEmbed, successEmbed } from "../utils/embeds";

async function respond(ctx: CommandContext, payload: { content?: string; embeds?: any[] }) {
  if (ctx.interaction) {
    if (ctx.interaction.replied) {
      await ctx.interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
      return;
    }

    if (ctx.interaction.deferred) {
      await ctx.interaction.editReply(payload);
      return;
    }
    await ctx.interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    return;
  }

  if (ctx.message) {
    await ctx.message.reply(payload);
  }
}

function getGuildId(ctx: CommandContext): string | null {
  return ctx.interaction?.guildId || ctx.message?.guildId || null;
}

export default {
  name: "status",
  description: "Enable, disable, or show status monitor",
  slash: new SlashCommandBuilder()
    .setName("status")
    .setDescription("Server status controls")
    .addSubcommand((sub) =>
      sub
        .setName("enable")
        .setDescription("Enable status updates")
        .addStringOption((opt) => opt.setName("server").setDescription("Server name").setRequired(true))
        .addChannelOption((opt) => opt.setName("channel").setDescription("Status channel").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("disable")
        .setDescription("Disable status updates")
        .addStringOption((opt) => opt.setName("server").setDescription("Server name").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("show")
        .setDescription("Show status config")
        .addStringOption((opt) => opt.setName("server").setDescription("Server name").setRequired(true))
    ),
  async execute(ctx: CommandContext) {
    const guildId = getGuildId(ctx);
    if (!guildId) {
      await respond(ctx, { embeds: [errorEmbed("This command is guild-only.")] });
      return;
    }

    const fromSlash = Boolean(ctx.interaction);
    const action = fromSlash ? ctx.interaction!.options.getSubcommand() : (ctx.args[0] || "").toLowerCase();
    const name = fromSlash ? ctx.interaction!.options.getString("server", false) : ctx.args[1];

    if (!name) {
      await respond(ctx, { embeds: [errorEmbed("Usage: status <enable|disable|show> <server>")] });
      return;
    }

    const server = await ctx.app.prisma.server.findFirst({ where: { guildId, name } });
    if (!server) {
      await respond(ctx, { embeds: [errorEmbed(`Server **${name}** not found.`)] });
      return;
    }

    if (action === "enable") {
      const channelId = fromSlash
        ? ctx.interaction!.options.getChannel("channel", true).id
        : ctx.message?.channelId || null;

      if (!channelId) {
        await respond(ctx, { embeds: [errorEmbed("Could not determine status channel.")] });
        return;
      }

      await ctx.app.prisma.server.update({
        where: { id: server.id },
        data: { statusEnabled: true, statusChannelId: channelId }
      });

      await ctx.app.statusMonitor.runOnce();
      await respond(ctx, {
        embeds: [successEmbed("Status Enabled", `Status updates enabled for **${server.name}**.`)]
      });
      return;
    }

    if (action === "disable") {
      await ctx.app.prisma.server.update({
        where: { id: server.id },
        data: { statusEnabled: false }
      });

      await respond(ctx, {
        embeds: [successEmbed("Status Disabled", `Status updates disabled for **${server.name}**.`)]
      });
      return;
    }

    if (action === "show") {
      const details = [
        `Server: **${server.name}**`,
        `Address: ${server.host}:${server.port}`,
        `Enabled: ${server.statusEnabled ? "yes" : "no"}`,
        `Channel: ${server.statusChannelId ? `<#${server.statusChannelId}>` : "not set"}`
      ].join("\n");

      await respond(ctx, {
        embeds: [successEmbed("Status Settings", details)]
      });
      return;
    }

    await respond(ctx, { embeds: [errorEmbed("Usage: status <enable|disable|show> <server>")] });
  }
} satisfies AppCommand;
