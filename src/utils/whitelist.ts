import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  GuildMember,
  PermissionFlagsBits,
  User
} from "discord.js";
import { WhitelistEdition, WhitelistRequest, WhitelistRequestStatus } from "@prisma/client";
import { AppContainer } from "../types";
import { logger } from "./logger";

type SendableChannel = {
  send: (payload: { embeds?: any[]; components?: any[]; content?: string }) => Promise<unknown>;
};

type ReviewChannel = SendableChannel & {
  messages: {
    fetch: (messageId: string) => Promise<any>;
  };
};

function isSendableChannel(channel: unknown): channel is SendableChannel {
  return Boolean(channel) && typeof (channel as { send?: unknown }).send === "function";
}

function isReviewChannel(channel: unknown): channel is ReviewChannel {
  if (!isSendableChannel(channel)) return false;

  const maybeChannel = channel as { messages?: { fetch?: unknown } };
  return typeof maybeChannel.messages?.fetch === "function";
}

export const WHITELIST_BUTTON_JAVA = "whitelist:start:java";
export const WHITELIST_BUTTON_BEDROCK = "whitelist:start:bedrock";
export const WHITELIST_MODAL_PREFIX = "whitelist:submit:";
export const WHITELIST_APPROVE_PREFIX = "whitelist:approve:";
export const WHITELIST_REJECT_PREFIX = "whitelist:reject:";
export const WHITELIST_REJECT_MODAL_PREFIX = "whitelist:reject-modal:";

export function whitelistAccessEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("Minecraft Whitelist Access")
    .setDescription(
      [
        "Access to the server is protected through our verification system.",
        "",
        "Choose your Minecraft edition below and submit your username to request whitelist access.",
        "Please ensure your username is correct before submitting."
      ].join("\n")
    )
    .setTimestamp();
}

export function whitelistAccessButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(WHITELIST_BUTTON_BEDROCK)
      .setLabel("Whitelist from Bedrock Server")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(WHITELIST_BUTTON_JAVA)
      .setLabel("Whitelist from Java Server")
      .setStyle(ButtonStyle.Success)
  );
}

export function staffReviewButtons(requestId: string, disabled = false): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${WHITELIST_APPROVE_PREFIX}${requestId}`)
      .setLabel("Approve Request")
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabled),
    new ButtonBuilder()
      .setCustomId(`${WHITELIST_REJECT_PREFIX}${requestId}`)
      .setLabel("Reject Request")
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabled)
  );
}

export function requestEmbed(payload: {
  requestId: string;
  discordUserTag: string;
  discordUserId: string;
  username: string;
  edition: WhitelistEdition;
  createdAt: Date;
  status: WhitelistRequestStatus;
  reviewedById?: string | null;
  reviewedAt?: Date | null;
}): EmbedBuilder {
  const statusText = payload.status === WhitelistRequestStatus.PENDING
    ? "Pending"
    : payload.status === WhitelistRequestStatus.APPROVED
      ? "Approved"
      : "Rejected";

  const embed = new EmbedBuilder()
    .setColor(payload.status === WhitelistRequestStatus.PENDING ? 0xfee75c : 0x57f287)
    .setTitle("Whitelist Request")
    .addFields(
      { name: "Discord User", value: `${payload.discordUserTag} (<@${payload.discordUserId}>)`, inline: false },
      { name: "Minecraft Username", value: payload.username, inline: true },
      { name: "Edition Type", value: formatEdition(payload.edition), inline: true },
      { name: "Request Time", value: `<t:${Math.floor(payload.createdAt.getTime() / 1000)}:F>`, inline: false },
      { name: "Current Status", value: statusText, inline: true },
      { name: "Request ID", value: payload.requestId, inline: true }
    )
    .setTimestamp();

  if (payload.reviewedById && payload.reviewedAt) {
    embed.addFields(
      { name: "Reviewed By", value: `<@${payload.reviewedById}>`, inline: true },
      { name: "Reviewed At", value: `<t:${Math.floor(payload.reviewedAt.getTime() / 1000)}:F>`, inline: true }
    );
  }

  return embed;
}

export function pendingDmEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Whitelist Request Submitted")
    .setDescription(
      [
        "Your whitelist request has been submitted successfully.",
        "",
        "Please wait while our staff reviews your request.",
        "You will receive another DM once your whitelist request is approved."
      ].join("\n")
    )
    .setTimestamp();
}

export function approvedDmEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle("Whitelist Approved")
    .setDescription(
      [
        "You have been successfully whitelisted on the Minecraft server.",
        "",
        "You can now join and start playing.",
        "Welcome to the community!"
      ].join("\n")
    )
    .setTimestamp();
}

export function rejectedDmEmbed(reason: string): EmbedBuilder {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle("Whitelist Rejected")
    .setDescription(
      [
        "Your whitelist request has been rejected.",
        "",
        `Reason: ${reason}`,
        "",
        "You can contact staff if you need more details."
      ].join("\n")
    )
    .setTimestamp();
}

export function formatEdition(edition: WhitelistEdition): string {
  return edition === WhitelistEdition.BEDROCK ? "Bedrock Edition" : "Java Edition";
}

export function parseMentionedRoleId(token: string | undefined): string | null {
  if (!token) return null;
  const match = token.match(/^<@&(\d+)>$/);
  return match?.[1] ?? null;
}

export function parseMentionedUserId(token: string | undefined): string | null {
  if (!token) return null;
  const match = token.match(/^<@!?(\d+)>$/);
  return match?.[1] ?? null;
}

export function parseMentionedChannelId(token: string | undefined): string | null {
  if (!token) return null;
  const match = token.match(/^<#(\d+)>$/);
  return match?.[1] ?? null;
}

export function isValidMinecraftUsername(value: string): boolean {
  const trimmed = value.trim();
  return /^[A-Za-z0-9_ ]{3,20}$/.test(trimmed);
}

export async function hasWhitelistAccess(app: AppContainer, guildId: string, member: GuildMember | null): Promise<boolean> {
  if (!member) return false;

  if (member.permissions.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  const modRoles = await app.prisma.whitelistModRole.findMany({
    where: { guildId }
  });

  if (modRoles.length === 0) {
    return false;
  }

  return modRoles.some((role) => member.roles.cache.has(role.roleId));
}

export async function approveRequestById(
  app: AppContainer,
  guildId: string,
  requestId: string,
  reviewer: User
): Promise<{ ok: true; request: WhitelistRequest } | { ok: false; reason: string }> {
  const request = await app.prisma.whitelistRequest.findFirst({
    where: {
      id: requestId,
      guildId,
      status: WhitelistRequestStatus.PENDING
    }
  });

  if (!request) {
    return { ok: false, reason: "Pending request not found." };
  }

  const updated = await app.prisma.whitelistRequest.update({
    where: { id: request.id },
    data: {
      status: WhitelistRequestStatus.APPROVED,
      reviewedById: reviewer.id,
      reviewedAt: new Date()
    }
  });

  const user = await app.client.users.fetch(updated.userId).catch(() => null);
  if (user) {
    await user.send({ embeds: [approvedDmEmbed()] }).catch(() => {
      logger.warn({ userId: user.id }, "Could not DM whitelist approval message");
    });
  }

  const config = await app.prisma.whitelistConfig.findUnique({ where: { guildId } });
  if (config) {
    const staffChannelUnknown: unknown = await app.client.channels.fetch(config.staffChannelId).catch(() => null);
    if (isSendableChannel(staffChannelUnknown)) {
      const staffChannel = staffChannelUnknown;
      await staffChannel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle("Whitelist Approved")
            .setDescription(`<@${updated.userId}> was approved by <@${reviewer.id}>.`)
            .addFields(
              { name: "Minecraft Username", value: updated.username, inline: true },
              { name: "Edition Type", value: formatEdition(updated.edition), inline: true },
              { name: "Request ID", value: updated.id, inline: true }
            )
            .setTimestamp()
        ]
      }).catch(() => {
        logger.warn({ channelId: config.staffChannelId }, "Could not post whitelist approval log");
      });

      if (updated.reviewMessageId && isReviewChannel(staffChannelUnknown)) {
        const reviewChannel = staffChannelUnknown;
        const reviewMessage = await reviewChannel.messages.fetch(updated.reviewMessageId).catch(() => null);
        if (reviewMessage) {
          await reviewMessage.edit({
            embeds: [
              requestEmbed({
                requestId: updated.id,
                discordUserTag: user ? user.tag : `User ${updated.userId}`,
                discordUserId: updated.userId,
                username: updated.username,
                edition: updated.edition,
                createdAt: updated.createdAt,
                status: updated.status,
                reviewedById: updated.reviewedById,
                reviewedAt: updated.reviewedAt
              })
            ],
            components: [staffReviewButtons(updated.id, true)]
          }).catch(() => {
            logger.warn({ messageId: updated.reviewMessageId }, "Could not update whitelist review message");
          });
        }
      }
    }
  }

  return { ok: true, request: updated };
}

export async function rejectRequestById(
  app: AppContainer,
  guildId: string,
  requestId: string,
  reviewer: User,
  reason: string
): Promise<{ ok: true; request: WhitelistRequest } | { ok: false; reason: string }> {
  const request = await app.prisma.whitelistRequest.findFirst({
    where: {
      id: requestId,
      guildId,
      status: WhitelistRequestStatus.PENDING
    }
  });

  if (!request) {
    return { ok: false, reason: "Pending request not found." };
  }

  const updated = await app.prisma.whitelistRequest.update({
    where: { id: request.id },
    data: {
      status: WhitelistRequestStatus.REJECTED,
      reviewedById: reviewer.id,
      reviewedAt: new Date()
    }
  });

  const user = await app.client.users.fetch(updated.userId).catch(() => null);
  if (user) {
    await user.send({ embeds: [rejectedDmEmbed(reason)] }).catch(() => {
      logger.warn({ userId: user.id }, "Could not DM whitelist rejection message");
    });
  }

  const config = await app.prisma.whitelistConfig.findUnique({ where: { guildId } });
  if (config) {
    const staffChannelUnknown: unknown = await app.client.channels.fetch(config.staffChannelId).catch(() => null);
    if (isSendableChannel(staffChannelUnknown)) {
      const staffChannel = staffChannelUnknown;
      await staffChannel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle("Whitelist Rejected")
            .setDescription(`<@${updated.userId}> was rejected by <@${reviewer.id}>.`)
            .addFields(
              { name: "Minecraft Username", value: updated.username, inline: true },
              { name: "Edition Type", value: formatEdition(updated.edition), inline: true },
              { name: "Request ID", value: updated.id, inline: true },
              { name: "Reason", value: reason, inline: false }
            )
            .setTimestamp()
        ]
      }).catch(() => {
        logger.warn({ channelId: config.staffChannelId }, "Could not post whitelist rejection log");
      });

      if (updated.reviewMessageId && isReviewChannel(staffChannelUnknown)) {
        const reviewChannel = staffChannelUnknown;
        const reviewMessage = await reviewChannel.messages.fetch(updated.reviewMessageId).catch(() => null);
        if (reviewMessage) {
          await reviewMessage.edit({
            embeds: [
              requestEmbed({
                requestId: updated.id,
                discordUserTag: user ? user.tag : `User ${updated.userId}`,
                discordUserId: updated.userId,
                username: updated.username,
                edition: updated.edition,
                createdAt: updated.createdAt,
                status: updated.status,
                reviewedById: updated.reviewedById,
                reviewedAt: updated.reviewedAt
              }).addFields({ name: "Rejection Reason", value: reason, inline: false })
            ],
            components: [staffReviewButtons(updated.id, true)]
          }).catch(() => {
            logger.warn({ messageId: updated.reviewMessageId }, "Could not update rejected review message");
          });
        }
      }
    }
  }

  return { ok: true, request: updated };
}
