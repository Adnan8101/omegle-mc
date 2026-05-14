import { MessageFlags,  SlashCommandBuilder } from "discord.js";
import { AppCommand, CommandContext } from "../types";
import { errorEmbed, successEmbed } from "../utils/embeds";

async function respond(ctx: CommandContext, payload: { content?: string; embeds?: any[] }) {
  if (ctx.interaction) {
    if (ctx.interaction.replied || ctx.interaction.deferred) {
      await ctx.interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
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
  name: "server",
  description: "Manage Minecraft server settings",
  aliases: ["srv"],
  slash: new SlashCommandBuilder()
    .setName("server")
    .setDescription("Manage Minecraft server")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add server for this guild")
        .addStringOption((opt) => opt.setName("name").setDescription("Server name").setRequired(true))
        .addStringOption((opt) => opt.setName("host").setDescription("Server host").setRequired(true))
        .addIntegerOption((opt) =>
          opt.setName("port").setDescription("Server port").setRequired(true).setMinValue(1).setMaxValue(65535)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("Edit an existing server")
        .addStringOption((opt) => opt.setName("name").setDescription("Server name").setRequired(true))
        .addStringOption((opt) => opt.setName("host").setDescription("New host").setRequired(false))
        .addIntegerOption((opt) =>
          opt.setName("port").setDescription("New port").setRequired(false).setMinValue(1).setMaxValue(65535)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Delete a server")
        .addStringOption((opt) => opt.setName("name").setDescription("Server name").setRequired(true))
    )
    .addSubcommand((sub) => sub.setName("list").setDescription("List servers for this guild")),
  async execute(ctx: CommandContext) {
    const guildId = getGuildId(ctx);
    if (!guildId) {
      await respond(ctx, { embeds: [errorEmbed("This command can only be used inside a guild.")] });
      return;
    }

    const fromSlash = Boolean(ctx.interaction);
    const action = fromSlash ? ctx.interaction!.options.getSubcommand() : (ctx.args[0] || "").toLowerCase();

    if (!["add", "edit", "delete", "list"].includes(action)) {
      await respond(ctx, {
        embeds: [errorEmbed("Usage: /server <add|edit|delete|list> or !server <add|edit|delete|list>")]
      });
      return;
    }

    if (action === "add") {
      const name = fromSlash ? ctx.interaction!.options.getString("name", true) : ctx.args[1];
      const host = fromSlash ? ctx.interaction!.options.getString("host", true) : ctx.args[2];
      const portRaw = fromSlash ? ctx.interaction!.options.getInteger("port", true) : Number(ctx.args[3]);
      const port = Number(portRaw);

      if (!name || !host || !Number.isInteger(port)) {
        await respond(ctx, { embeds: [errorEmbed("Usage: server add <name> <host> <port>")] });
        return;
      }

      await ctx.app.prisma.server.create({
        data: { guildId, name, host, port }
      });

      await respond(ctx, {
        embeds: [successEmbed("Server Added", `Saved **${name}** as ${host}:${port}.`)]
      });
      return;
    }

    if (action === "edit") {
      const name = fromSlash ? ctx.interaction!.options.getString("name", true) : ctx.args[1];
      const host = fromSlash ? ctx.interaction!.options.getString("host", false) : ctx.args[2];
      const portInput = fromSlash ? ctx.interaction!.options.getInteger("port", false) : ctx.args[3];
      const port = portInput !== null && portInput !== undefined ? Number(portInput) : undefined;

      if (!name) {
        await respond(ctx, { embeds: [errorEmbed("Usage: server edit <name> [host] [port]")] });
        return;
      }

      const existing = await ctx.app.prisma.server.findFirst({ where: { guildId, name } });
      if (!existing) {
        await respond(ctx, { embeds: [errorEmbed(`Server **${name}** was not found.`)] });
        return;
      }

      await ctx.app.prisma.server.update({
        where: { id: existing.id },
        data: {
          host: host || existing.host,
          port: Number.isInteger(port) ? port : existing.port
        }
      });

      await respond(ctx, {
        embeds: [successEmbed("Server Updated", `Updated **${name}** successfully.`)]
      });
      return;
    }

    if (action === "delete") {
      const name = fromSlash ? ctx.interaction!.options.getString("name", true) : ctx.args[1];
      if (!name) {
        await respond(ctx, { embeds: [errorEmbed("Usage: server delete <name>")] });
        return;
      }

      const result = await ctx.app.prisma.server.deleteMany({ where: { guildId, name } });
      if (result.count === 0) {
        await respond(ctx, { embeds: [errorEmbed(`Server **${name}** was not found.`)] });
        return;
      }

      await respond(ctx, {
        embeds: [successEmbed("Server Deleted", `Deleted **${name}**.`)]
      });
      return;
    }

    const servers = await ctx.app.prisma.server.findMany({
      where: { guildId },
      orderBy: { createdAt: "desc" }
    });

    if (servers.length === 0) {
      await respond(ctx, { embeds: [errorEmbed("No servers configured for this guild.")] });
      return;
    }

    const rows = servers
      .map((server) => {
        const statusState = server.statusEnabled ? "status:on" : "status:off";
        const bridgeState = server.bridgeEnabled ? "bridge:on" : "bridge:off";
        return `• **${server.name}** -> ${server.host}:${server.port} (${statusState}, ${bridgeState})`;
      })
      .join("\n");

    await respond(ctx, {
      embeds: [successEmbed("Configured Servers", rows)]
    });
  }
} satisfies AppCommand;
