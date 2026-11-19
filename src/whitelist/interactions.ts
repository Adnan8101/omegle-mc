import {
  ButtonInteraction,
  LabelBuilder,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle
} from "discord.js";
import { WhitelistEdition } from "@prisma/client";
import { AppContainer } from "../types";
import { failure, NO_MENTIONS, success, V2Component, warning } from "../ui/components";
import { Icons } from "../ui/theme";
import { hasWhitelistAccess, reviewRequest, submitRequest } from "./service";
import { myRequestView, WhitelistIds } from "./views";

const EPHEMERAL_V2 = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;

async function replyEphemeral(interaction: ButtonInteraction | ModalSubmitInteraction, ...components: V2Component[]) {
  if (interaction.deferred && !interaction.replied) {
    await interaction.editReply({ components, flags: MessageFlags.IsComponentsV2, allowedMentions: NO_MENTIONS });
  } else if (interaction.replied) {
    await interaction.followUp({ components, flags: EPHEMERAL_V2, allowedMentions: NO_MENTIONS });
  } else {
    await interaction.reply({ components, flags: EPHEMERAL_V2, allowedMentions: NO_MENTIONS });
  }
}

async function ensureReviewer(app: AppContainer, interaction: ButtonInteraction | ModalSubmitInteraction): Promise<boolean> {
  if (!interaction.inCachedGuild()) {
    await replyEphemeral(interaction, failure("This action is only available inside a server."));
    return false;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (await hasWhitelistAccess(app, interaction.guildId, member)) return true;

  await replyEphemeral(interaction, failure("Only whitelist moderators can review requests.", "Missing permission"));
  return false;
}

function usernameModal(edition: WhitelistEdition): ModalBuilder {
  const isBedrock = edition === WhitelistEdition.BEDROCK;

  return new ModalBuilder()
    .setCustomId(`${WhitelistIds.submitModalPrefix}${edition}`)
    .setTitle(isBedrock ? "Bedrock Whitelist Request" : "Java Whitelist Request")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(isBedrock ? "Xbox gamertag" : "Minecraft username")
        .setDescription(
          isBedrock
            ? "Exactly as it appears in game (3–20 characters)."
            : "Your Java account name, exactly as it appears in game (3–16 characters)."
        )
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("mc_username")
            .setStyle(TextInputStyle.Short)
            .setPlaceholder(isBedrock ? "e.g. Steve Builder" : "e.g. Steve_Builder")
            .setRequired(true)
            .setMinLength(3)
            .setMaxLength(isBedrock ? 20 : 16)
        )
    );
}

function rejectModal(requestId: string): ModalBuilder {
  return new ModalBuilder()
    .setCustomId(`${WhitelistIds.rejectModalPrefix}${requestId}`)
    .setTitle("Reject Whitelist Request")
    .addLabelComponents(
      new LabelBuilder()
        .setLabel("Reason")
        .setDescription("Shared with the applicant in their DM.")
        .setTextInputComponent(
          new TextInputBuilder()
            .setCustomId("reject_reason")
            .setStyle(TextInputStyle.Paragraph)
            .setPlaceholder("e.g. Username doesn't match your account")
            .setRequired(true)
            .setMinLength(3)
            .setMaxLength(300)
        )
    );
}

/** Returns true when the button belonged to the whitelist system. */
export async function handleWhitelistButton(app: AppContainer, interaction: ButtonInteraction): Promise<boolean> {
  const { customId } = interaction;

  if (customId === WhitelistIds.startJava || customId === WhitelistIds.startBedrock) {
    const edition = customId === WhitelistIds.startBedrock ? WhitelistEdition.BEDROCK : WhitelistEdition.JAVA;
    await interaction.showModal(usernameModal(edition));
    return true;
  }

  if (customId === WhitelistIds.checkStatus) {
    if (!interaction.guildId) return true;
    const latest = await app.prisma.whitelistRequest.findFirst({
      where: { guildId: interaction.guildId, userId: interaction.user.id },
      orderBy: { createdAt: "desc" }
    });
    await replyEphemeral(interaction, myRequestView(latest));
    return true;
  }

  if (customId.startsWith(WhitelistIds.approvePrefix)) {
    if (!(await ensureReviewer(app, interaction)) || !interaction.inCachedGuild()) return true;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const result = await reviewRequest(app, {
      guild: interaction.guild,
      requestId: customId.slice(WhitelistIds.approvePrefix.length),
      reviewer: interaction.user,
      decision: { type: "approve" }
    });

    await replyEphemeral(
      interaction,
      result.ok
        ? success("Request approved", `<@${result.value.userId}> (\`${result.value.username}\`) has been whitelisted.`)
        : warning("Nothing to do", result.reason)
    );
    return true;
  }

  if (customId.startsWith(WhitelistIds.rejectPrefix)) {
    if (!(await ensureReviewer(app, interaction))) return true;
    await interaction.showModal(rejectModal(customId.slice(WhitelistIds.rejectPrefix.length)));
    return true;
  }

  return false;
}

/** Returns true when the modal belonged to the whitelist system. */
export async function handleWhitelistModal(app: AppContainer, interaction: ModalSubmitInteraction): Promise<boolean> {
  const { customId } = interaction;

  if (customId.startsWith(WhitelistIds.rejectModalPrefix)) {
    if (!(await ensureReviewer(app, interaction)) || !interaction.inCachedGuild()) return true;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const reason = interaction.fields.getTextInputValue("reject_reason").trim() || "No reason provided.";
    const result = await reviewRequest(app, {
      guild: interaction.guild,
      requestId: customId.slice(WhitelistIds.rejectModalPrefix.length),
      reviewer: interaction.user,
      decision: { type: "reject", reason }
    });

    await replyEphemeral(
      interaction,
      result.ok
        ? success("Request rejected", `<@${result.value.userId}> has been notified.`)
        : warning("Nothing to do", result.reason)
    );
    return true;
  }

  if (customId.startsWith(WhitelistIds.submitModalPrefix)) {
    if (!interaction.inCachedGuild()) {
      await replyEphemeral(interaction, failure("This action is only available inside a server."));
      return true;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const edition =
      customId.slice(WhitelistIds.submitModalPrefix.length) === WhitelistEdition.BEDROCK
        ? WhitelistEdition.BEDROCK
        : WhitelistEdition.JAVA;

    const result = await submitRequest(app, {
      guild: interaction.guild,
      user: interaction.user,
      edition,
      username: interaction.fields.getTextInputValue("mc_username")
    });

    if (!result.ok) {
      await replyEphemeral(interaction, failure(result.reason, "Request not submitted"));
      return true;
    }

    await replyEphemeral(
      interaction,
      success("Request submitted", [
        `Your request for \`${result.value.request.username}\` is now with the staff team.`,
        result.value.dmDelivered
          ? "We'll DM you as soon as it has been reviewed."
          : `${Icons.warning} Your DMs are closed — use **Check my request** on the panel to follow its status.`
      ])
    );
    return true;
  }

  return false;
}
