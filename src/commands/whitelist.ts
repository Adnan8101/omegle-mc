import {
  GuildBasedChannel,
  InteractionContextType,
  PermissionFlagsBits,
  SlashCommandBuilder
} from "discord.js";
import { WhitelistRequestStatus } from "@prisma/client";
import { AppCommand, CommandContext } from "../types";
import { Card, failure, info, success, usage, v2 } from "../ui/components";
import { Colors, Icons } from "../ui/theme";
import { getMember, requireGuild, requirePermission, respond } from "../utils/context";
import { hasWhitelistAccess } from "../whitelist/service";
import { panelView, pendingListView } from "../whitelist/views";
import { MESSAGE_CHANNEL_TYPES, parseChannelMention, parseRoleMention } from "./shared";

/** Checks the bot can actually post in a channel and explains what is missing. */
function missingBotAccess(channel: GuildBasedChannel): string | null {
  const me = channel.guild.members.me;
  const perms = me ? channel.permissionsFor(me) : null;
  if (!perms?.has(PermissionFlagsBits.ViewChannel)) return `I can't see <#${channel.id}>.`;
  if (!perms.has(PermissionFlagsBits.SendMessages)) return `I can't send messages in <#${channel.id}>.`;
  return null;
}

async function resolveChannel(ctx: CommandContext, id: string | null): Promise<GuildBasedChannel | null> {
  if (!id) return null;
  const channel = await ctx.app.client.channels.fetch(id).catch(() => null);
  if (!channel || channel.isDMBased() || !channel.isSendable()) return null;
  return channel;
}

export default {
  name: "whitelist",
  description: "Whitelist request system",
  slash: new SlashCommandBuilder()
    .setName("whitelist")
    .setDescription("Whitelist request system")
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName("setup")
        .setDescription("Post the whitelist request panel (Administrator)")
        .addChannelOption((opt) =>
          opt
            .setName("request_channel")
            .setDescription("Public channel where members request access")
            .setRequired(true)
            .addChannelTypes(...MESSAGE_CHANNEL_TYPES)
        )
        .addChannelOption((opt) =>
          opt
            .setName("staff_channel")
            .setDescription("Private channel where staff review requests")
            .setRequired(true)
            .addChannelTypes(...MESSAGE_CHANNEL_TYPES)
        )
    )
    .addSubcommand((sub) => sub.setName("info").setDescription("Show the whitelist configuration"))
    .addSubcommand((sub) => sub.setName("pending").setDescription("List requests awaiting review"))
    .addSubcommandGroup((group) =>
      group
        .setName("mod-role")
        .setDescription("Manage roles that can review requests")
        .addSubcommand((sub) =>
          sub
            .setName("add")
            .setDescription("Allow a role to review requests")
            .addRoleOption((opt) => opt.setName("role").setDescription("Role to add").setRequired(true))
        )
        .addSubcommand((sub) =>
          sub
            .setName("remove")
            .setDescription("Stop a role from reviewing requests")
            .addRoleOption((opt) => opt.setName("role").setDescription("Role to remove").setRequired(true))
        )
        .addSubcommand((sub) => sub.setName("show").setDescription("List reviewer roles"))
    ),

  async execute(ctx: CommandContext) {
    const guildId = await requireGuild(ctx);
    if (!guildId) return;

    const options = ctx.interaction?.options;
    const group = options ? options.getSubcommandGroup(false) : ctx.args[0]?.toLowerCase() === "mod-role" ? "mod-role" : null;
    const action = options ? options.getSubcommand() : (group ? ctx.args[1] : ctx.args[0])?.toLowerCase() ?? "";
    const p = ctx.app.prisma;

    if (!group && action === "setup") {
      if (!(await requirePermission(ctx, PermissionFlagsBits.Administrator))) return;

      const requestChannel = await resolveChannel(
        ctx,
        options ? options.getChannel("request_channel", true).id : parseChannelMention(ctx.args[1])
      );
      const staffChannel = await resolveChannel(
        ctx,
        options ? options.getChannel("staff_channel", true).id : parseChannelMention(ctx.args[2])
      );

      if (!requestChannel || !staffChannel) {
        await respond(ctx, usage("whitelist setup #request-channel #staff-channel"));
        return;
      }

      const problem = missingBotAccess(requestChannel) ?? missingBotAccess(staffChannel);
      if (problem) {
        await respond(ctx, failure(`${problem} Update the channel permissions and try again.`, "Missing access"));
        return;
      }

      // Replace the previous panel instead of leaving duplicates behind.
      const previous = await p.whitelistConfig.findUnique({ where: { guildId } });
      if (previous?.requestMessageId) {
        const oldChannel = await resolveChannel(ctx, previous.requestChannelId);
        if (oldChannel?.isTextBased()) {
          await oldChannel.messages.delete(previous.requestMessageId).catch(() => undefined);
        }
      }

      const guild = requestChannel.guild;
      if (!requestChannel.isSendable()) return;
      const panel = await requestChannel.send(v2([panelView(guild.name, guild.iconURL({ size: 256 }))]));

      await p.whitelistConfig.upsert({
        where: { guildId },
        update: { requestChannelId: requestChannel.id, staffChannelId: staffChannel.id, requestMessageId: panel.id },
        create: { guildId, requestChannelId: requestChannel.id, staffChannelId: staffChannel.id, requestMessageId: panel.id }
      });

      await respond(
        ctx,
        success("Whitelist is live", [
          `**Request panel:** <#${requestChannel.id}>`,
          `**Staff reviews:** <#${staffChannel.id}>`,
          "",
          "Next, choose who can review requests with `/whitelist mod-role add`."
        ])
      );
      return;
    }

    if (!group && action === "info") {
      if (!(await requirePermission(ctx, PermissionFlagsBits.ManageGuild))) return;

      const config = await p.whitelistConfig.findUnique({ where: { guildId }, include: { modRoles: true } });
      if (!config) {
        await respond(ctx, info("Not set up", "Run `/whitelist setup` to post the request panel."));
        return;
      }

      const counts = await p.whitelistRequest.groupBy({ by: ["status"], where: { guildId }, _count: true });
      const count = (status: WhitelistRequestStatus) => counts.find((c) => c.status === status)?._count ?? 0;

      await respond(
        ctx,
        new Card(Colors.minecraft)
          .header(`${Icons.whitelist} Whitelist configuration`)
          .divider()
          .fields([
            ["Request panel", `<#${config.requestChannelId}>`],
            ["Staff reviews", `<#${config.staffChannelId}>`],
            ["Reviewer roles", config.modRoles.length ? config.modRoles.map((r) => `<@&${r.roleId}>`).join(" ") : "Admins & Manage Server only"]
          ])
          .divider()
          .fields([
            ["Pending", `\`${count(WhitelistRequestStatus.PENDING)}\``],
            ["Approved", `\`${count(WhitelistRequestStatus.APPROVED)}\``],
            ["Rejected", `\`${count(WhitelistRequestStatus.REJECTED)}\``]
          ])
          .build()
      );
      return;
    }

    if (!group && action === "pending") {
      if (!(await hasWhitelistAccess(ctx.app, guildId, await getMember(ctx)))) {
        await respond(ctx, failure("Only whitelist moderators can view pending requests.", "Missing permission"));
        return;
      }

      const config = await p.whitelistConfig.findUnique({ where: { guildId } });
      if (!config) {
        await respond(ctx, info("Not set up", "Run `/whitelist setup` first."));
        return;
      }

      const where = { guildId, status: WhitelistRequestStatus.PENDING };
      const [requests, total] = await Promise.all([
        p.whitelistRequest.findMany({ where, orderBy: { createdAt: "asc" }, take: 15 }),
        p.whitelistRequest.count({ where })
      ]);

      await respond(ctx, pendingListView(requests, total, config.staffChannelId, guildId));
      return;
    }

    if (group === "mod-role") {
      // Managing reviewers is a server-management task; reviewers can't promote others.
      if (!(await requirePermission(ctx, PermissionFlagsBits.ManageGuild))) return;

      const roleId = options ? options.getRole("role")?.id ?? null : parseRoleMention(ctx.args[2]);

      if (action === "show") {
        const roles = await p.whitelistModRole.findMany({ where: { guildId }, orderBy: { createdAt: "asc" } });
        await respond(
          ctx,
          new Card(Colors.brand)
            .text(
              "### 🛡️ Reviewer roles",
              roles.length
                ? roles.map((role) => `• <@&${role.roleId}>`).join("\n")
                : "No reviewer roles yet — only Administrators and Manage Server members can review."
            )
            .build()
        );
        return;
      }

      if ((action === "add" || action === "remove") && !roleId) {
        await respond(ctx, usage(`whitelist mod-role ${action} @role`));
        return;
      }

      if (action === "add" && roleId) {
        const config = await p.whitelistConfig.findUnique({ where: { guildId } });
        if (!config) {
          await respond(ctx, info("Set up the whitelist first", "Run `/whitelist setup` before adding reviewer roles."));
          return;
        }
        if (roleId === guildId) {
          await respond(ctx, failure("The @everyone role can't be a reviewer role.", "Invalid role"));
          return;
        }

        await p.whitelistModRole.upsert({
          where: { guildId_roleId: { guildId, roleId } },
          update: {},
          create: { guildId, roleId }
        });
        await respond(ctx, success("Reviewer role added", `<@&${roleId}> can now approve and reject requests.`));
        return;
      }

      if (action === "remove" && roleId) {
        const { count } = await p.whitelistModRole.deleteMany({ where: { guildId, roleId } });
        await respond(
          ctx,
          count
            ? success("Reviewer role removed", `<@&${roleId}> can no longer review requests.`)
            : info("Nothing to remove", `<@&${roleId}> isn't a reviewer role.`)
        );
        return;
      }

      await respond(ctx, usage("whitelist mod-role add @role", "whitelist mod-role remove @role", "whitelist mod-role show"));
      return;
    }

    await respond(
      ctx,
      usage("whitelist setup #request-channel #staff-channel", "whitelist info", "whitelist pending", "whitelist mod-role <add|remove|show>")
    );
  }
} satisfies AppCommand;
