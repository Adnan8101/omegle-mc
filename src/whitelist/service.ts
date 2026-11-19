import { Guild, GuildMember, PermissionFlagsBits, User } from "discord.js";
import { WhitelistEdition, WhitelistRequest, WhitelistRequestStatus } from "@prisma/client";
import { AppContainer } from "../types";
import { v2 } from "../ui/components";
import { logger } from "../utils/logger";
import { dmViews, reviewCardView } from "./views";

export type Result<T> = { ok: true; value: T } | { ok: false; reason: string };

const JAVA_USERNAME = /^[A-Za-z0-9_]{3,16}$/;
const BEDROCK_GAMERTAG = /^[A-Za-z0-9_ ]{3,20}$/;

export function validateUsername(edition: WhitelistEdition, value: string): string | null {
  if (edition === WhitelistEdition.JAVA) {
    return JAVA_USERNAME.test(value) ? null : "Java usernames are 3–16 characters: letters, numbers and `_` only.";
  }
  if (!BEDROCK_GAMERTAG.test(value) || value.includes("  ")) {
    return "Bedrock gamertags are 3–20 characters: letters, numbers, `_` and single spaces.";
  }
  return null;
}

export async function hasWhitelistAccess(app: AppContainer, guildId: string, member: GuildMember | null): Promise<boolean> {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator) || member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    return true;
  }

  const modRoles = await app.prisma.whitelistModRole.findMany({ where: { guildId }, select: { roleId: true } });
  return modRoles.some((role) => member.roles.cache.has(role.roleId));
}

async function fetchStaffChannel(app: AppContainer, channelId: string) {
  const channel = await app.client.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isTextBased() || channel.isDMBased() || !channel.isSendable()) return null;
  return channel;
}

// Prevents a double-submitted modal from creating two pending requests.
const submitting = new Set<string>();

export async function submitRequest(
  app: AppContainer,
  input: { guild: Guild; user: User; edition: WhitelistEdition; username: string }
): Promise<Result<{ request: WhitelistRequest; dmDelivered: boolean }>> {
  const { guild, user, edition } = input;
  const username = input.username.trim();
  const lockKey = `${guild.id}:${user.id}`;

  if (submitting.has(lockKey)) return { ok: false, reason: "Your request is already being submitted." };
  submitting.add(lockKey);

  try {
    const config = await app.prisma.whitelistConfig.findUnique({ where: { guildId: guild.id } });
    if (!config) return { ok: false, reason: "The whitelist hasn't been set up on this server yet." };

    const invalid = validateUsername(edition, username);
    if (invalid) return { ok: false, reason: invalid };

    const existing = await app.prisma.whitelistRequest.findFirst({
      where: {
        guildId: guild.id,
        userId: user.id,
        status: { in: [WhitelistRequestStatus.APPROVED, WhitelistRequestStatus.PENDING] }
      }
    });
    if (existing?.status === WhitelistRequestStatus.APPROVED) {
      return { ok: false, reason: `You're already whitelisted as \`${existing.username}\`.` };
    }
    if (existing?.status === WhitelistRequestStatus.PENDING) {
      return { ok: false, reason: "You already have a request waiting for review." };
    }

    const taken = await app.prisma.whitelistRequest.findFirst({
      where: {
        guildId: guild.id,
        edition,
        username: { equals: username, mode: "insensitive" },
        status: { in: [WhitelistRequestStatus.APPROVED, WhitelistRequestStatus.PENDING] }
      }
    });
    if (taken) return { ok: false, reason: `The username \`${username}\` has already been requested by another member.` };

    const staffChannel = await fetchStaffChannel(app, config.staffChannelId);
    if (!staffChannel) {
      logger.warn({ guildId: guild.id, channelId: config.staffChannelId }, "Whitelist staff channel unavailable");
      return { ok: false, reason: "The staff review channel is unavailable. Please let a server admin know." };
    }

    const request = await app.prisma.whitelistRequest.create({
      data: { guildId: guild.id, userId: user.id, username, edition, status: WhitelistRequestStatus.PENDING }
    });

    const modRoleIds = (
      await app.prisma.whitelistModRole.findMany({ where: { guildId: guild.id }, select: { roleId: true } })
    ).map((role) => role.roleId);

    try {
      const card = await staffChannel.send(
        v2(
          reviewCardView({ request, applicantTag: user.tag, applicantAvatar: user.displayAvatarURL({ size: 128 }), modRoleIds }),
          { parse: [], roles: modRoleIds }
        )
      );
      await app.prisma.whitelistRequest.update({ where: { id: request.id }, data: { reviewMessageId: card.id } });
    } catch (error) {
      logger.error({ error, guildId: guild.id }, "Could not post whitelist review card");
      await app.prisma.whitelistRequest.delete({ where: { id: request.id } }).catch(() => undefined);
      return { ok: false, reason: "We couldn't reach the staff team right now. Please try again later." };
    }

    const dmDelivered = await user
      .send(v2([dmViews.submitted(guild.name, request)]))
      .then(() => true)
      .catch(() => false);

    return { ok: true, value: { request, dmDelivered } };
  } finally {
    submitting.delete(lockKey);
  }
}

export type ReviewDecision = { type: "approve" } | { type: "reject"; reason: string };

/**
 * Approves or rejects a pending request. The status change is a single
 * conditional update, so two staff members clicking at once can't both win.
 */
export async function reviewRequest(
  app: AppContainer,
  input: { guild: Guild; requestId: string; reviewer: User; decision: ReviewDecision }
): Promise<Result<WhitelistRequest>> {
  const { guild, requestId, reviewer, decision } = input;
  const status = decision.type === "approve" ? WhitelistRequestStatus.APPROVED : WhitelistRequestStatus.REJECTED;
  const reason = decision.type === "reject" ? decision.reason : null;

  const { count } = await app.prisma.whitelistRequest.updateMany({
    where: { id: requestId, guildId: guild.id, status: WhitelistRequestStatus.PENDING },
    data: { status, reviewedById: reviewer.id, reviewedAt: new Date(), reviewNote: reason }
  });

  if (count === 0) {
    const current = await app.prisma.whitelistRequest.findFirst({ where: { id: requestId, guildId: guild.id } });
    if (!current) return { ok: false, reason: "That request no longer exists." };
    const by = current.reviewedById ? ` by <@${current.reviewedById}>` : "";
    return { ok: false, reason: `This request was already ${current.status.toLowerCase()}${by}.` };
  }

  const request = await app.prisma.whitelistRequest.findUniqueOrThrow({ where: { id: requestId } });
  const applicant = await app.client.users.fetch(request.userId).catch(() => null);

  if (applicant) {
    const dm = reason ? dmViews.rejected(guild.name, request, reason) : dmViews.approved(guild.name, request);
    await applicant.send(v2([dm])).catch(() => {
      logger.info({ userId: applicant.id }, "Applicant has DMs closed; review result not delivered");
    });
  }

  await refreshReviewCard(app, guild, request, applicant);
  return { ok: true, value: request };
}

/** Updates the staff card in place, re-posting it if the original can't be edited. */
async function refreshReviewCard(app: AppContainer, guild: Guild, request: WhitelistRequest, applicant: User | null) {
  const config = await app.prisma.whitelistConfig.findUnique({ where: { guildId: guild.id } });
  if (!config) return;

  const channel = await fetchStaffChannel(app, config.staffChannelId);
  if (!channel) return;

  const payload = v2(
    reviewCardView({
      request,
      applicantTag: applicant?.tag,
      applicantAvatar: applicant?.displayAvatarURL({ size: 128 }),
      reason: request.reviewNote
    })
  );

  const original = request.reviewMessageId
    ? await channel.messages.fetch(request.reviewMessageId).catch(() => null)
    : null;

  if (original) {
    const edited = await original
      .edit(payload)
      .then(() => true)
      .catch(() => false);
    if (edited) return;
    // Cards from older versions used embeds and can't be converted in place.
    await original.delete().catch(() => undefined);
  }

  try {
    const sent = await channel.send(payload);
    await app.prisma.whitelistRequest.update({ where: { id: request.id }, data: { reviewMessageId: sent.id } });
  } catch (error) {
    logger.warn({ error, requestId: request.id }, "Could not update whitelist review card");
  }
}
