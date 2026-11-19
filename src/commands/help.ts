import { MessageFlags, SlashCommandBuilder, StringSelectMenuInteraction } from "discord.js";
import { env } from "../config/env";
import { AppContainer, AppCommand, CommandContext } from "../types";
import { helpCategories, helpView } from "../ui/views/help";
import { respond } from "../utils/context";

function render(app: AppContainer, category?: string | null) {
  const user = app.client.user;
  return helpView({
    botName: user?.username ?? "Bot",
    avatar: user?.displayAvatarURL({ size: 128 }) ?? null,
    prefix: env.PREFIX,
    category
  });
}

/** Switches the help page in place when a category is picked from the menu. */
export async function handleHelpSelect(app: AppContainer, interaction: StringSelectMenuInteraction): Promise<void> {
  const value = interaction.values[0];
  await interaction.update({
    components: [render(app, value === "overview" ? null : value)],
    flags: MessageFlags.IsComponentsV2
  });
}

export default {
  name: "help",
  description: "Show every command",
  aliases: ["h", "commands"],
  slash: new SlashCommandBuilder()
    .setName("help")
    .setDescription("Show every command and how to use it")
    .addStringOption((opt) =>
      opt
        .setName("category")
        .setDescription("Jump straight to a category")
        .addChoices(...helpCategories.map((category) => ({ name: category.title, value: category.id })))
    ),

  async execute(ctx: CommandContext) {
    const requested = ctx.interaction ? ctx.interaction.options.getString("category") : ctx.args[0]?.toLowerCase();
    // Accept ids and titles for prefix use, e.g. `!help bridge` or `!help status`.
    const category = helpCategories.find(
      (entry) => entry.id === requested || entry.title.toLowerCase().startsWith(requested ?? "\0")
    );
    await respond(ctx, render(ctx.app, category?.id));
  }
} satisfies AppCommand;
