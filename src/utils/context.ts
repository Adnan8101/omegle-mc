import { GuildMember, MessageFlags, PermissionFlagsBits, PermissionsBitField, User } from "discord.js";
import { CommandContext } from "../types";
import { failure, NO_MENTIONS, V2Component } from "../ui/components";

export function getGuildId(ctx: CommandContext): string | null {
  return ctx.interaction?.guildId ?? ctx.message?.guildId ?? null;
}

export function getUser(ctx: CommandContext): User {
  return ctx.interaction?.user ?? ctx.message!.author;
}

export async function getMember(ctx: CommandContext): Promise<GuildMember | null> {
  const guild = ctx.interaction?.guild ?? ctx.message?.guild;
  if (!guild) return null;
  return guild.members.fetch(getUser(ctx).id).catch(() => null);
}

function memberPermissions(ctx: CommandContext): Readonly<PermissionsBitField> | null {
  return ctx.interaction?.memberPermissions ?? ctx.message?.member?.permissions ?? null;
}

const permissionLabels = new Map<bigint, string>([
  [PermissionFlagsBits.Administrator, "Administrator"],
  [PermissionFlagsBits.ManageGuild, "Manage Server"]
]);

/** Responds with an error and returns false when the caller lacks the permission. */
export async function requirePermission(ctx: CommandContext, permission: bigint): Promise<boolean> {
  if (memberPermissions(ctx)?.has(permission)) return true;

  const label = permissionLabels.get(permission) ?? "the required";
  await respond(ctx, failure(`You need the **${label}** permission to use this command.`, "Missing permission"));
  return false;
}

/** Responds with an error and returns null outside of a guild. */
export async function requireGuild(ctx: CommandContext): Promise<string | null> {
  const guildId = getGuildId(ctx);
  if (!guildId) {
    await respond(ctx, failure("This command can only be used inside a server."));
  }
  return guildId;
}

/**
 * Sends a Components V2 reply. Slash replies are ephemeral (the interaction is
 * deferred ephemerally by the dispatcher); prefix replies quote the message.
 */
export async function respond(ctx: CommandContext, ...components: V2Component[]): Promise<void> {
  const interaction = ctx.interaction;

  if (interaction) {
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ components, flags: MessageFlags.IsComponentsV2, allowedMentions: NO_MENTIONS });
      return;
    }

    const payload = {
      components,
      flags: MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral,
      allowedMentions: NO_MENTIONS
    } as const;

    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
    return;
  }

  if (ctx.message) {
    await ctx.message.reply({ components, flags: MessageFlags.IsComponentsV2, allowedMentions: NO_MENTIONS });
  }
}
