import { GuildMember, MessageFlags, SlashCommandBuilder } from "discord.js";
import { WhitelistRequestStatus } from "@prisma/client";
import { AppCommand, CommandContext } from "../types";
import { errorEmbed, successEmbed } from "../utils/embeds";
import { hasWhitelistAccess, parseMentionedUserId, rejectRequestById } from "../utils/whitelist";

async function respond(ctx: CommandContext, payload: { content?: string; embeds?: any[] }) {
  if (ctx.interaction) {
    if (ctx.interaction.replied) {
      await ctx.interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
      return;
    }

    if (ctx.interaction.deferred) {
      await ctx.interaction.editReply(payload);
      return;
    }

    await ctx.interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    return;
  }

  if (ctx.message) {
    await ctx.message.reply(payload);
  }
}

async function silentAcknowledge(ctx: CommandContext): Promise<void> {
  if (!ctx.interaction) return;
  if (ctx.interaction.replied || ctx.interaction.deferred) return;

  await ctx.interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await ctx.interaction.deleteReply().catch(() => undefined);
}

function getGuildId(ctx: CommandContext): string | null {
  return ctx.interaction?.guildId || ctx.message?.guildId || null;
}

async function getGuildMember(ctx: CommandContext): Promise<GuildMember | null> {
  const guild = ctx.interaction?.guild || ctx.message?.guild;
  const userId = ctx.interaction?.user.id || ctx.message?.author.id;
  if (!guild || !userId) return null;

  return guild.members.fetch(userId).catch(() => null);
}

export default {
  name: "reject",
  description: "Reject pending whitelist request for a user",
  slash: new SlashCommandBuilder()
    .setName("reject")
    .setDescription("Reject a pending whitelist request")
    .addUserOption((opt) => opt.setName("user").setDescription("Discord user to reject").setRequired(true))
    .addStringOption((opt) => opt.setName("reason").setDescription("Reason for rejection").setRequired(true)),
  async execute(ctx: CommandContext) {
    const guildId = getGuildId(ctx);
    if (!guildId) {
      await respond(ctx, { embeds: [errorEmbed("This command can only be used inside a guild.")] });
      return;
    }

    const member = await getGuildMember(ctx);
    const allowed = await hasWhitelistAccess(ctx.app, guildId, member);
    if (!allowed) {
      await silentAcknowledge(ctx);
      return;
    }

    const fromSlash = Boolean(ctx.interaction);
    const targetUserId = fromSlash
      ? ctx.interaction!.options.getUser("user", true).id
      : parseMentionedUserId(ctx.args[0]);

    const reason = fromSlash
      ? ctx.interaction!.options.getString("reason", true).trim()
      : ctx.args.slice(1).join(" ").trim();

    if (!targetUserId || reason.length < 3) {
      await respond(ctx, { embeds: [errorEmbed("Usage: reject @user <reason>")] });
      return;
    }

    const pending = await ctx.app.prisma.whitelistRequest.findFirst({
      where: {
        guildId,
        userId: targetUserId,
        status: WhitelistRequestStatus.PENDING
      },
      orderBy: {
        createdAt: "desc"
      }
    });

    if (!pending) {
      await respond(ctx, {
        embeds: [errorEmbed("No pending whitelist request was found for that user.")]
      });
      return;
    }

    const reviewer = ctx.interaction?.user || ctx.message!.author;
    const result = await rejectRequestById(ctx.app, guildId, pending.id, reviewer, reason);
    if (!result.ok) {
      await respond(ctx, { embeds: [errorEmbed(result.reason)] });
      return;
    }

    await respond(ctx, {
      embeds: [
        successEmbed(
          "User Rejected",
          `Rejected whitelist request for <@${result.request.userId}> (${result.request.username}).`
        )
      ]
    });
  }
} satisfies AppCommand;
