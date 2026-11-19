import {
  AutocompleteInteraction,
  ChatInputCommandInteraction,
  Events,
  Interaction,
  MessageFlags
} from "discord.js";
import { handleHelpSelect } from "../commands/help";
import { AppContainer } from "../types";
import { failure, NO_MENTIONS } from "../ui/components";
import { HELP_SELECT_ID } from "../ui/views/help";
import { logger } from "../utils/logger";
import { handleWhitelistButton, handleWhitelistModal } from "../whitelist/interactions";

async function handleAutocomplete(app: AppContainer, interaction: AutocompleteInteraction): Promise<void> {
  const command = app.commands.get(interaction.commandName);
  if (!command?.autocomplete) {
    await interaction.respond([]);
    return;
  }
  await command.autocomplete(interaction, app);
}

async function handleCommand(app: AppContainer, interaction: ChatInputCommandInteraction): Promise<void> {
  const command = app.commands.get(interaction.commandName);
  if (!command) {
    await interaction.reply({
      components: [failure("This command is no longer available.")],
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await command.execute({ app, source: "slash", interaction, args: [] });
}

/** Last-resort error reply so users never see "The application did not respond". */
async function reportFailure(interaction: Interaction): Promise<void> {
  if (!interaction.isRepliable()) return;

  const components = [failure("Something went wrong while handling that. Please try again in a moment.")];
  try {
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ components, flags: MessageFlags.IsComponentsV2, allowedMentions: NO_MENTIONS });
    } else if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ components, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ components, flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral });
    }
  } catch {
    // The interaction token may have expired; nothing more we can do.
  }
}

export function registerInteractionCreateEvent(app: AppContainer): void {
  app.client.on(Events.InteractionCreate, async (interaction) => {
    try {
      if (interaction.isAutocomplete()) {
        await handleAutocomplete(app, interaction);
      } else if (interaction.isChatInputCommand()) {
        await handleCommand(app, interaction);
      } else if (interaction.isButton()) {
        await handleWhitelistButton(app, interaction);
      } else if (interaction.isStringSelectMenu() && interaction.customId === HELP_SELECT_ID) {
        await handleHelpSelect(app, interaction);
      } else if (interaction.isModalSubmit()) {
        await handleWhitelistModal(app, interaction);
      }
    } catch (error) {
      logger.error(
        { error, type: interaction.type, id: interaction.isCommand() ? interaction.commandName : "customId" in interaction ? interaction.customId : undefined },
        "Interaction handler failed"
      );
      await reportFailure(interaction);
    }
  });
}
