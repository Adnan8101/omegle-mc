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
  name: "bridge",
  description: "Enable or disable chat bridge",
  slash: new SlashCommandBuilder()
    .setName("bridge")
    .setDescription("Bridge controls")
    .addSubcommand((sub) =>
      sub
        .setName("enable")
        .setDescription("Enable Discord-Minecraft bridge")
        .addStringOption((opt) => opt.setName("server").setDescription("Server name").setRequired(true))
        .addChannelOption((opt) => opt.setName("channel").setDescription("Bridge channel").setRequired(true))
    )
    .addSubcommand((sub) =>
      sub
        .setName("disable")
        .setDescription("Disable Discord-Minecraft bridge")
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
      await respond(ctx, { embeds: [errorEmbed("Usage: bridge <enable|disable> <server>")] });
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
        await respond(ctx, { embeds: [errorEmbed("Could not determine bridge channel.")] });
        return;
      }

      await ctx.app.prisma.server.update({
        where: { id: server.id },
        data: { bridgeEnabled: true, bridgeChannelId: channelId }
      });

      await respond(ctx, {
        embeds: [successEmbed("Bridge Enabled", `Bridge enabled for **${server.name}** in <#${channelId}>.`)]
      });
      return;
    }

    if (action === "disable") {
      await ctx.app.prisma.server.update({
        where: { id: server.id },
        data: { bridgeEnabled: false }
      });

      await respond(ctx, {
        embeds: [successEmbed("Bridge Disabled", `Bridge disabled for **${server.name}**.`)]
      });
      return;
    }

    await respond(ctx, { embeds: [errorEmbed("Usage: bridge <enable|disable> <server>")] });
  }
} satisfies AppCommand;
