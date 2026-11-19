import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { AppCommand, CommandContext } from "../types";
import { failure, info, success, usage } from "../ui/components";
import { serverDetailView, serverListView } from "../ui/views/general";
import { requireGuild, requirePermission, respond } from "../utils/context";
import { findServerOrReply, isValidHost, isValidPort, SERVER_NAME_PATTERN, serverAutocomplete } from "./shared";

const DEFAULT_JAVA_PORT = 25565;
const NAME_RULES = "Names are 1–32 characters: letters, numbers, `_`, `-` or `.`.";

async function nameTaken(ctx: CommandContext, guildId: string, name: string, exceptId?: string): Promise<boolean> {
  const clash = await ctx.app.prisma.server.findFirst({
    where: { guildId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { NOT: { id: exceptId } } : {}) }
  });
  if (clash) await respond(ctx, failure(`A server named **${clash.name}** already exists.`, "Name in use"));
  return Boolean(clash);
}

export default {
  name: "server",
  description: "Manage Minecraft servers",
  aliases: ["srv"],
  slash: new SlashCommandBuilder()
    .setName("server")
    .setDescription("Manage the Minecraft servers tracked in this Discord")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setContexts(InteractionContextType.Guild)
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Register a Minecraft server")
        .addStringOption((opt) => opt.setName("name").setDescription("Short name, e.g. survival").setRequired(true).setMaxLength(32))
        .addStringOption((opt) => opt.setName("host").setDescription("Hostname or IP address").setRequired(true).setMaxLength(253))
        .addIntegerOption((opt) =>
          opt.setName("port").setDescription(`Port (default ${DEFAULT_JAVA_PORT})`).setMinValue(1).setMaxValue(65535)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("Change a server's name, host or port")
        .addStringOption((opt) => opt.setName("name").setDescription("Server to edit").setRequired(true).setAutocomplete(true))
        .addStringOption((opt) => opt.setName("host").setDescription("New hostname or IP").setMaxLength(253))
        .addIntegerOption((opt) => opt.setName("port").setDescription("New port").setMinValue(1).setMaxValue(65535))
        .addStringOption((opt) => opt.setName("rename").setDescription("New name").setMaxLength(32))
    )
    .addSubcommand((sub) =>
      sub
        .setName("delete")
        .setDescription("Remove a server and its status panel")
        .addStringOption((opt) => opt.setName("name").setDescription("Server to delete").setRequired(true).setAutocomplete(true))
    )
    .addSubcommand((sub) => sub.setName("list").setDescription("Show every configured server")),

  autocomplete: serverAutocomplete,

  async execute(ctx: CommandContext) {
    const guildId = await requireGuild(ctx);
    if (!guildId || !(await requirePermission(ctx, PermissionFlagsBits.ManageGuild))) return;

    const options = ctx.interaction?.options;
    const action = options ? options.getSubcommand() : (ctx.args[0] ?? "").toLowerCase();
    const p = ctx.app.prisma;

    if (action === "add") {
      const name = options ? options.getString("name", true).trim() : ctx.args[1];
      const host = (options ? options.getString("host", true) : ctx.args[2])?.trim().toLowerCase();
      const port = options ? options.getInteger("port") ?? DEFAULT_JAVA_PORT : Number(ctx.args[3] ?? DEFAULT_JAVA_PORT);

      if (!name || !host) {
        await respond(ctx, usage("server add <name> <host> [port]"));
        return;
      }
      if (!SERVER_NAME_PATTERN.test(name)) {
        await respond(ctx, failure(NAME_RULES, "Invalid name"));
        return;
      }
      if (!isValidHost(host) || !isValidPort(port)) {
        await respond(ctx, failure("Enter a valid hostname/IP and a port between 1 and 65535.", "Invalid address"));
        return;
      }
      if (await nameTaken(ctx, guildId, name)) return;

      const server = await p.server.create({ data: { guildId, name, host, port } });
      await respond(ctx, serverDetailView(server, `✅ Server added — next, try \`/status enable\` or \`/bridge enable\`.`));
      return;
    }

    if (action === "edit") {
      const name = options ? options.getString("name", true) : ctx.args[1];
      const host = (options ? options.getString("host") : ctx.args[2])?.trim().toLowerCase() || undefined;
      const portRaw = options ? options.getInteger("port") : ctx.args[3];
      const port = portRaw === null || portRaw === undefined ? undefined : Number(portRaw);
      const rename = options ? options.getString("rename")?.trim() || undefined : ctx.args[4];

      if (!name) {
        await respond(ctx, usage("server edit <name> [host] [port] [new-name]"));
        return;
      }

      const server = await findServerOrReply(ctx, guildId, name);
      if (!server) return;

      if (!host && port === undefined && !rename) {
        await respond(ctx, info("Nothing to change", "Provide a new `host`, `port` or `rename` value."));
        return;
      }
      if ((host && !isValidHost(host)) || (port !== undefined && !isValidPort(port))) {
        await respond(ctx, failure("Enter a valid hostname/IP and a port between 1 and 65535.", "Invalid address"));
        return;
      }
      if (rename && !SERVER_NAME_PATTERN.test(rename)) {
        await respond(ctx, failure(NAME_RULES, "Invalid name"));
        return;
      }
      if (rename && (await nameTaken(ctx, guildId, rename, server.id))) return;

      const updated = await p.server.update({
        where: { id: server.id },
        data: { host: host ?? server.host, port: port ?? server.port, name: rename ?? server.name }
      });

      ctx.app.statusMonitor.refresh(updated.id).catch(() => undefined);
      await respond(ctx, serverDetailView(updated, "✅ Server updated"));
      return;
    }

    if (action === "delete") {
      const name = options ? options.getString("name", true) : ctx.args[1];
      if (!name) {
        await respond(ctx, usage("server delete <name>"));
        return;
      }

      const server = await findServerOrReply(ctx, guildId, name);
      if (!server) return;

      await ctx.app.statusMonitor.removePanel(server);
      await p.server.delete({ where: { id: server.id } });
      await respond(ctx, success("Server deleted", `**${server.name}** and its status panel have been removed.`));
      return;
    }

    if (action === "list") {
      const servers = await p.server.findMany({ where: { guildId }, orderBy: { createdAt: "asc" } });
      await respond(
        ctx,
        servers.length === 0
          ? info("No servers yet", "Add one with `/server add <name> <host> [port]`.")
          : serverListView(servers)
      );
      return;
    }

    await respond(ctx, usage("server add <name> <host> [port]", "server edit <name> [host] [port]", "server delete <name>", "server list"));
  }
} satisfies AppCommand;
