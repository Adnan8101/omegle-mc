import { SlashCommandBuilder } from "discord.js";
import { env } from "../config/env";
import { AppCommand, CommandContext } from "../types";
import { usage } from "../ui/components";
import { pingView, uptimeView } from "../ui/views/general";
import { respond } from "../utils/context";
import { formatDuration } from "../utils/helpers";

export default {
  name: "utility",
  description: "Utility commands",
  aliases: ["ping", "uptime"],
  slash: new SlashCommandBuilder()
    .setName("utility")
    .setDescription("Utility commands")
    .addSubcommand((sub) => sub.setName("ping").setDescription("Check the bot's latency"))
    .addSubcommand((sub) => sub.setName("uptime").setDescription("Show how long the bot has been running")),

  async execute(ctx: CommandContext) {
    const action = ctx.interaction ? ctx.interaction.options.getSubcommand() : (ctx.args[0] ?? "").toLowerCase();
    const { client, mcClient } = ctx.app;

    if (action === "ping") {
      const created = ctx.interaction?.createdTimestamp ?? ctx.message?.createdTimestamp;
      await respond(
        ctx,
        pingView(client.ws.ping, created ? Math.max(0, Date.now() - created) : null, {
          enabled: env.MC_BRIDGE_ENABLED,
          connected: mcClient.connected,
          target: mcClient.target
        })
      );
      return;
    }

    if (action === "uptime") {
      await respond(ctx, uptimeView(ctx.app.startedAt, formatDuration(Date.now() - ctx.app.startedAt)));
      return;
    }

    await respond(ctx, usage("utility <ping|uptime>", "help"));
  }
} satisfies AppCommand;
