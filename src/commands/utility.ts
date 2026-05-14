import { MessageFlags,  SlashCommandBuilder } from "discord.js";
import { env } from "../config/env";
import { AppCommand, CommandContext } from "../types";
import { errorEmbed, successEmbed } from "../utils/embeds";
import { formatDuration } from "../utils/helpers";

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

export default {
  name: "utility",
  description: "Utility command wrapper",
  aliases: ["ping", "help", "uptime", "h"],
  slash: new SlashCommandBuilder()
    .setName("utility")
    .setDescription("Utility commands")
    .addSubcommand((sub) => sub.setName("ping").setDescription("Show bot latency"))
    .addSubcommand((sub) => sub.setName("help").setDescription("Show command help"))
    .addSubcommand((sub) => sub.setName("uptime").setDescription("Show bot uptime")),
  async execute(ctx: CommandContext) {
    const fromSlash = Boolean(ctx.interaction);
    const action = fromSlash ? ctx.interaction!.options.getSubcommand() : (ctx.args[0] || "help").toLowerCase();

    if (action === "ping") {
      const ping = ctx.app.client.ws.ping;
      await respond(ctx, {
        embeds: [successEmbed("Pong", `Discord gateway latency: **${ping}ms**`)]
      });
      return;
    }

    if (action === "uptime") {
      const uptime = Date.now() - ctx.app.startedAt;
      await respond(ctx, {
        embeds: [successEmbed("Uptime", formatDuration(uptime))]
      });
      return;
    }

    if (action === "help") {
      const helpText = [
        `Prefix: **${env.PREFIX}**`,
        "- /server <add|edit|delete|list>",
        "- /status <enable|disable|show>",
        "- /bridge <enable|disable>",
        "- /whitelist <setup|mod-role>",
        "- /verify <user>",
        "- /utility <ping|help|uptime>",
        `Prefix examples: ${env.PREFIX}server list, ${env.PREFIX}whitelist setup, ${env.PREFIX}verify @user`
      ].join("\n");

      await respond(ctx, {
        embeds: [successEmbed("Help", helpText)]
      });
      return;
    }

    await respond(ctx, {
      embeds: [errorEmbed("Usage: utility <ping|help|uptime>")]
    });
  }
} satisfies AppCommand;
