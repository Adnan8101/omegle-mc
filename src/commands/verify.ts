import { GuildMember, MessageFlags, SlashCommandBuilder } from "discord.js";
import { WhitelistRequestStatus } from "@prisma/client";
import { AppCommand, CommandContext } from "../types";
import { errorEmbed, successEmbed } from "../utils/embeds";
import { approveRequestById, hasWhitelistAccess, parseMentionedUserId } from "../utils/whitelist";

async function respond(ctx: CommandContext, payload: { content?: string; embeds?: any[] }) {
  if (ctx.interaction) {
    if (ctx.interaction.replied || ctx.interaction.deferred) {
      await ctx.interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
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
  name: "verify",
  description: "Approve pending whitelist request for a user",
  slash: new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Approve a pending whitelist request")
    .addUserOption((opt) => opt.setName("user").setDescription("Discord user to verify").setRequired(true)),
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

    if (!targetUserId) {
      await respond(ctx, { embeds: [errorEmbed("Usage: verify @user")] });
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

    const result = await approveRequestById(ctx.app, guildId, pending.id, ctx.interaction?.user || ctx.message!.author);
    if (!result.ok) {
      await respond(ctx, { embeds: [errorEmbed(result.reason)] });
      return;
    }

    await respond(ctx, {
      embeds: [
        successEmbed(
          "User Verified",
          `Approved whitelist request for <@${result.request.userId}> (${result.request.username}).`
        )
      ]
    });
  }
} satisfies AppCommand;
