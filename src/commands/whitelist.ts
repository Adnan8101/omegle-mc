import {
  GuildMember,
  Message,
  MessageFlags,
  PermissionsBitField,
  SlashCommandBuilder,
  TextChannel
} from "discord.js";
import { AppCommand, CommandContext } from "../types";
import { errorEmbed, successEmbed } from "../utils/embeds";
import {
  hasWhitelistAccess,
  parseMentionedChannelId,
  parseMentionedRoleId,
  whitelistAccessButtons,
  whitelistAccessEmbed
} from "../utils/whitelist";

type SendableChannel = {
  send: (payload: { content?: string; embeds?: any[]; components?: any[] }) => Promise<{ id: string }>;
};

function isSendableChannel(channel: unknown): channel is SendableChannel {
  return Boolean(channel) && typeof (channel as { send?: unknown }).send === "function";
}

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

async function askForChannelMention(
  channel: TextChannel,
  userId: string,
  prompt: string
): Promise<string | null> {
  await channel.send({ content: `<@${userId}> ${prompt}` });

  for (let attempt = 0; attempt < 3; attempt++) {
    const collected = await channel.awaitMessages({
      filter: (message: Message) => message.author.id === userId,
      max: 1,
      time: 60_000
    });

    const answer = collected.first();
    if (!answer) {
      return null;
    }

    const channelId = parseMentionedChannelId(answer.content.trim());
    if (channelId) {
      return channelId;
    }

    await channel.send({
      content: `<@${userId}> Please mention a channel in this format: <#channel>.`
    });
  }

  return null;
}

export default {
  name: "whitelist",
  description: "Manage whitelist verification system",
  slash: new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("Whitelist verification system")
    .addSubcommand((sub) => sub.setName("setup").setDescription("Run interactive whitelist setup"))
    .addSubcommandGroup((group) =>
      group
        .setName("mod-role")
        .setDescription("Manage whitelist moderator roles")
        .addSubcommand((sub) =>
          sub
            .setName("add")
            .setDescription("Add a moderator role")
            .addRoleOption((opt) => opt.setName("role").setDescription("Role to add").setRequired(true))
        )
        .addSubcommand((sub) =>
          sub
            .setName("remove")
            .setDescription("Remove a moderator role")
            .addRoleOption((opt) => opt.setName("role").setDescription("Role to remove").setRequired(true))
        )
        .addSubcommand((sub) => sub.setName("show").setDescription("Show configured moderator roles"))
    ),
  async execute(ctx: CommandContext) {
    const guildId = getGuildId(ctx);
    if (!guildId) {
      await respond(ctx, { embeds: [errorEmbed("This command can only be used inside a guild.")] });
      return;
    }

    const fromSlash = Boolean(ctx.interaction);
    const action = fromSlash ? ctx.interaction!.options.getSubcommand() : (ctx.args[0] || "").toLowerCase();
    const group = fromSlash ? ctx.interaction!.options.getSubcommandGroup(false) : (ctx.args[0] || "").toLowerCase();

    if (action === "setup") {
      const member = await getGuildMember(ctx);
      if (!member?.permissions.has(PermissionsBitField.Flags.Administrator)) {
        await respond(ctx, {
          embeds: [errorEmbed("Only administrators can run whitelist setup.")]
        });
        return;
      }

      const textChannel = ctx.interaction?.channel || ctx.message?.channel;
      const userId = ctx.interaction?.user.id || ctx.message?.author.id;

      if (!textChannel || !userId || !(textChannel instanceof TextChannel)) {
        await respond(ctx, { embeds: [errorEmbed("Could not start setup in this channel.")] });
        return;
      }

      const requestChannelId = await askForChannelMention(
        textChannel,
        userId,
        "Step 1: Mention the whitelist request channel."
      );

      if (!requestChannelId) {
        await respond(ctx, { embeds: [errorEmbed("Setup timed out before receiving a valid request channel.")] });
        return;
      }

      const staffChannelId = await askForChannelMention(
        textChannel,
        userId,
        "Step 2: Mention the private staff review channel."
      );

      if (!staffChannelId) {
        await respond(ctx, { embeds: [errorEmbed("Setup timed out before receiving a valid staff channel.")] });
        return;
      }

      const requestChannelUnknown: unknown = await ctx.app.client.channels.fetch(requestChannelId).catch(() => null);
      const staffChannelUnknown: unknown = await ctx.app.client.channels.fetch(staffChannelId).catch(() => null);

      if (!isSendableChannel(requestChannelUnknown)) {
        await respond(ctx, { embeds: [errorEmbed("The whitelist request channel is invalid.")] });
        return;
      }

      if (!isSendableChannel(staffChannelUnknown)) {
        await respond(ctx, { embeds: [errorEmbed("The staff review channel is invalid.")] });
        return;
      }

      const requestChannel = requestChannelUnknown;

      const sent = await requestChannel.send({
        embeds: [whitelistAccessEmbed()],
        components: [whitelistAccessButtons()]
      });

      await ctx.app.prisma.whitelistConfig.upsert({
        where: { guildId },
        update: {
          requestChannelId,
          staffChannelId,
          requestMessageId: sent.id
        },
        create: {
          guildId,
          requestChannelId,
          staffChannelId,
          requestMessageId: sent.id
        }
      });

      await respond(ctx, {
        embeds: [
          successEmbed(
            "Whitelist Setup Complete",
            [
              `Request Channel: <#${requestChannelId}>`,
              `Staff Review Channel: <#${staffChannelId}>`,
              "The whitelist request panel is now live."
            ].join("\n")
          )
        ]
      });
      return;
    }

    const isModRolePath = fromSlash ? group === "mod-role" : group === "mod-role";
    if (!isModRolePath) {
      await respond(ctx, { embeds: [errorEmbed("Usage: whitelist <setup|mod-role>")] });
      return;
    }

    const member = await getGuildMember(ctx);
    const allowed = await hasWhitelistAccess(ctx.app, guildId, member);
    if (!allowed) {
      await silentAcknowledge(ctx);
      return;
    }

    const roleId = fromSlash
      ? ctx.interaction!.options.getRole("role", false)?.id || null
      : parseMentionedRoleId(ctx.args[2]);

    const modRoleAction = fromSlash ? action : (ctx.args[1] || "").toLowerCase();

    if (modRoleAction === "add") {
      if (!roleId) {
        await respond(ctx, { embeds: [errorEmbed("Usage: whitelist mod-role add @role")] });
        return;
      }

      const existingConfig = await ctx.app.prisma.whitelistConfig.findUnique({ where: { guildId } });
      if (!existingConfig || !existingConfig.requestChannelId || !existingConfig.staffChannelId) {
        await respond(ctx, {
          embeds: [errorEmbed("Run whitelist setup before adding moderator roles.")]
        });
        return;
      }

      await ctx.app.prisma.whitelistModRole.upsert({
        where: {
          guildId_roleId: {
            guildId,
            roleId
          }
        },
        update: {},
        create: {
          guildId,
          roleId
        }
      });

      await respond(ctx, {
        embeds: [successEmbed("Moderator Role Added", `Added <@&${roleId}> as a whitelist moderator role.`)]
      });
      return;
    }

    if (modRoleAction === "remove") {
      if (!roleId) {
        await respond(ctx, { embeds: [errorEmbed("Usage: whitelist mod-role remove @role")] });
        return;
      }

      await ctx.app.prisma.whitelistModRole.deleteMany({
        where: {
          guildId,
          roleId
        }
      });

      await respond(ctx, {
        embeds: [successEmbed("Moderator Role Removed", `Removed <@&${roleId}> from whitelist moderator roles.`)]
      });
      return;
    }

    if (modRoleAction === "show") {
      const roles = await ctx.app.prisma.whitelistModRole.findMany({
        where: { guildId },
        orderBy: { createdAt: "asc" }
      });

      const roleLines = roles.length === 0
        ? "No moderator roles configured."
        : roles.map((role) => `• <@&${role.roleId}>`).join("\n");

      await respond(ctx, {
        embeds: [successEmbed("Whitelist Moderator Roles", roleLines)]
      });
      return;
    }

    await respond(ctx, {
      embeds: [errorEmbed("Usage: whitelist mod-role <add|remove|show>")]
    });
  }
} satisfies AppCommand;
