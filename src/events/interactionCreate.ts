import { MessageFlags } from "discord.js";
import { AppContainer } from "../types";
import { errorEmbed } from "../utils/embeds";
import { logger } from "../utils/logger";

export function registerInteractionCreateEvent(app: AppContainer): void {
  app.client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = app.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute({
        app,
        source: "slash",
        interaction,
        args: []
      });
    } catch (error) {
      logger.error({ error, command: interaction.commandName }, "Slash command failed");

      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({ embeds: [errorEmbed("Command execution failed.")], flags: MessageFlags.Ephemeral });
      }
    }
  });
}
