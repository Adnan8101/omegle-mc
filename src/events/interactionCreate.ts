import {
  ActionRowBuilder,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { WhitelistEdition, WhitelistRequestStatus } from "@prisma/client";
import { AppContainer } from "../types";
import { errorEmbed } from "../utils/embeds";
import { logger } from "../utils/logger";
import {
  approveRequestById,
  hasWhitelistAccess,
  isValidMinecraftUsername,
  pendingDmEmbed,
  requestEmbed,
  staffApproveButtons,
  WHITELIST_APPROVE_PREFIX,
  WHITELIST_BUTTON_BEDROCK,
  WHITELIST_BUTTON_JAVA,
  WHITELIST_MODAL_PREFIX
} from "../utils/whitelist";

type SendableChannel = {
  send: (payload: { embeds?: any[]; components?: any[]; content?: string }) => Promise<{ id: string }>;
};

function isSendableChannel(channel: unknown): channel is SendableChannel {
  return Boolean(channel) && typeof (channel as { send?: unknown }).send === "function";
}

export function registerInteractionCreateEvent(app: AppContainer): void {
  app.client.on("interactionCreate", async (interaction) => {
    if (interaction.isButton()) {
      if (interaction.customId === WHITELIST_BUTTON_JAVA || interaction.customId === WHITELIST_BUTTON_BEDROCK) {
        const edition = interaction.customId === WHITELIST_BUTTON_BEDROCK
          ? WhitelistEdition.BEDROCK
          : WhitelistEdition.JAVA;

        const modal = new ModalBuilder()
          .setCustomId(`${WHITELIST_MODAL_PREFIX}${edition}`)
          .setTitle(`Whitelist Request (${edition === WhitelistEdition.BEDROCK ? "Bedrock" : "Java"})`)
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId("mc_username")
                .setLabel("Minecraft Username")
                .setStyle(TextInputStyle.Short)
                .setRequired(true)
                .setMinLength(3)
                .setMaxLength(20)
            )
          );

        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId.startsWith(WHITELIST_APPROVE_PREFIX)) {
        const guildId = interaction.guildId;
        if (!guildId) {
          await interaction.deferUpdate();
          return;
        }

        const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
        const allowed = await hasWhitelistAccess(app, guildId, member || null);
        if (!allowed) {
          await interaction.deferUpdate();
          return;
        }

        const requestId = interaction.customId.slice(WHITELIST_APPROVE_PREFIX.length);
        const result = await approveRequestById(app, guildId, requestId, interaction.user);

        if (!result.ok) {
          await interaction.reply({
            embeds: [errorEmbed(result.reason)],
            flags: MessageFlags.Ephemeral
          });
          return;
        }

        await interaction.reply({
          flags: MessageFlags.Ephemeral,
          content: `Approved whitelist request for <@${result.request.userId}>.`
        });
        return;
      }
    }

    if (interaction.isModalSubmit()) {
      if (!interaction.customId.startsWith(WHITELIST_MODAL_PREFIX)) return;

      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.reply({
          embeds: [errorEmbed("This action is only available in a guild.")],
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const config = await app.prisma.whitelistConfig.findUnique({ where: { guildId } });
      if (!config || !config.staffChannelId) {
        await interaction.reply({
          embeds: [errorEmbed("Whitelist setup is not configured yet.")],
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const pendingForUser = await app.prisma.whitelistRequest.findFirst({
        where: {
          guildId,
          userId: interaction.user.id,
          status: WhitelistRequestStatus.PENDING
        }
      });

      if (pendingForUser) {
        await interaction.reply({
          embeds: [errorEmbed("You already have a pending whitelist request.")],
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const username = interaction.fields.getTextInputValue("mc_username").trim();
      if (!isValidMinecraftUsername(username)) {
        await interaction.reply({
          embeds: [errorEmbed("Invalid username. Use 3-20 characters: letters, numbers, spaces, or _")],
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      const editionRaw = interaction.customId.slice(WHITELIST_MODAL_PREFIX.length);
      const edition = editionRaw === WhitelistEdition.BEDROCK ? WhitelistEdition.BEDROCK : WhitelistEdition.JAVA;

      const request = await app.prisma.whitelistRequest.create({
        data: {
          guildId,
          userId: interaction.user.id,
          username,
          edition,
          status: WhitelistRequestStatus.PENDING
        }
      });

      const staffChannelUnknown: unknown = await app.client.channels.fetch(config.staffChannelId).catch(() => null);
      if (isSendableChannel(staffChannelUnknown)) {
        const staffChannel = staffChannelUnknown;
        const reviewMessage = await staffChannel.send({
          embeds: [
            requestEmbed({
              requestId: request.id,
              discordUserTag: interaction.user.tag,
              discordUserId: interaction.user.id,
              username: request.username,
              edition: request.edition,
              createdAt: request.createdAt,
              status: request.status
            })
          ],
          components: [staffApproveButtons(request.id)]
        });

        await app.prisma.whitelistRequest.update({
          where: { id: request.id },
          data: { reviewMessageId: reviewMessage.id }
        });
      }

      await interaction.user.send({ embeds: [pendingDmEmbed()] }).catch(() => {
        logger.warn({ userId: interaction.user.id }, "Could not DM whitelist pending message");
      });

      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content: "Your whitelist request has been submitted successfully. Please wait while staff reviews your request."
      });
      return;
    }

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
