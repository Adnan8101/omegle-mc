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
  rejectRequestById,
  requestEmbed,
  staffReviewButtons,
  WHITELIST_APPROVE_PREFIX,
  WHITELIST_BUTTON_BEDROCK,
  WHITELIST_BUTTON_JAVA,
  WHITELIST_REJECT_MODAL_PREFIX,
  WHITELIST_REJECT_PREFIX,
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

        await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);

        const requestId = interaction.customId.slice(WHITELIST_APPROVE_PREFIX.length);
        const result = await approveRequestById(app, guildId, requestId, interaction.user);

        if (!result.ok) {
          await interaction.editReply({
            embeds: [errorEmbed(result.reason)],
          });
          return;
        }

        await interaction.editReply({
          content: `Approved whitelist request for <@${result.request.userId}>.`
        });
        return;
      }

      if (interaction.customId.startsWith(WHITELIST_REJECT_PREFIX)) {
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

        const requestId = interaction.customId.slice(WHITELIST_REJECT_PREFIX.length);
        const modal = new ModalBuilder()
          .setCustomId(`${WHITELIST_REJECT_MODAL_PREFIX}${requestId}`)
          .setTitle("Reject Whitelist Request")
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(
              new TextInputBuilder()
                .setCustomId("reject_reason")
                .setLabel("Reason")
                .setStyle(TextInputStyle.Paragraph)
                .setRequired(true)
                .setMinLength(3)
                .setMaxLength(300)
            )
          );

        await interaction.showModal(modal);
        return;
      }
    }

    if (interaction.isModalSubmit()) {
      if (
        !interaction.customId.startsWith(WHITELIST_MODAL_PREFIX) &&
        !interaction.customId.startsWith(WHITELIST_REJECT_MODAL_PREFIX)
      ) {
        return;
      }

      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);

      const guildId = interaction.guildId;
      if (!guildId) {
        await interaction.editReply({
          embeds: [errorEmbed("This action is only available in a guild.")],
        });
        return;
      }

      if (interaction.customId.startsWith(WHITELIST_REJECT_MODAL_PREFIX)) {
        const requestId = interaction.customId.slice(WHITELIST_REJECT_MODAL_PREFIX.length);
        const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
        const allowed = await hasWhitelistAccess(app, guildId, member || null);
        if (!allowed) {
          await interaction.deleteReply().catch(() => undefined);
          return;
        }

        const reason = interaction.fields.getTextInputValue("reject_reason").trim() || "No reason provided.";
        const result = await rejectRequestById(app, guildId, requestId, interaction.user, reason);
        if (!result.ok) {
          await interaction.editReply({ embeds: [errorEmbed(result.reason)] });
          return;
        }

        await interaction.editReply({
          content: `Rejected whitelist request for <@${result.request.userId}>.`
        });
        return;
      }

      const config = await app.prisma.whitelistConfig.findUnique({ where: { guildId } });
      if (!config || !config.staffChannelId) {
        await interaction.editReply({
          embeds: [errorEmbed("Whitelist setup is not configured yet.")],
        });
        return;
      }

      const alreadyApproved = await app.prisma.whitelistRequest.findFirst({
        where: {
          guildId,
          userId: interaction.user.id,
          status: WhitelistRequestStatus.APPROVED
        }
      });

      if (alreadyApproved) {
        await interaction.editReply({
          embeds: [errorEmbed("You are already whitelisted.")],
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
        await interaction.editReply({
          embeds: [errorEmbed("You already have a pending whitelist request.")],
        });
        return;
      }

      const username = interaction.fields.getTextInputValue("mc_username").trim();
      if (!isValidMinecraftUsername(username)) {
        await interaction.editReply({
          embeds: [errorEmbed("Invalid username. Use 3-20 characters: letters, numbers, spaces, or _")],
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

        const modRoles = await app.prisma.whitelistModRole.findMany({ where: { guildId } });
        const roleMentions = modRoles.length ? modRoles.map((r) => `<@&${r.roleId}>`).join(" ") : "";
        const content = roleMentions ? `## New Request\n${roleMentions}` : "## New Request";

        const reviewMessage = await staffChannel.send({
          content,
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
          components: [staffReviewButtons(request.id)]
        });

        await app.prisma.whitelistRequest.update({
          where: { id: request.id },
          data: { reviewMessageId: reviewMessage.id }
        });
      }

      await interaction.user.send({ embeds: [pendingDmEmbed()] }).catch(() => {
        logger.warn({ userId: interaction.user.id }, "Could not DM whitelist pending message");
      });

      await interaction.editReply({
        content: "Your whitelist request has been submitted successfully. Please wait while staff reviews your request."
      });
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => undefined);

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

      if (interaction.deferred && !interaction.replied) {
        await interaction.editReply({ embeds: [errorEmbed("Command execution failed.")] });
      } else if (!interaction.replied) {
        await interaction.reply({ embeds: [errorEmbed("Command execution failed.")], flags: MessageFlags.Ephemeral });
      }
    }
  });
}
