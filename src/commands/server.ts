import { InteractionContextType, PermissionFlagsBits, SlashCommandBuilder } from "discord.js";
import { AppCommand, CommandContext } from "../types";
import { failure, info, success, usage } from "../ui/components";
import { serverDetailView, serverListView } from "../ui/views/general";
import { requireGuild, requirePermission, respond } from "../utils/context";
import {
  findServerOrReply,
  isValidHost,
  isValidPort,
  normalizeName,
  SERVER_NAME_PATTERN,
  serverAutocomplete
} from "./shared";

const DEFAULT_JAVA_PORT = 25565;
const NAME_RULES = "Names are 1–32 characters: letters, numbers, spaces, `_`, `-`, `.` or `'`.";

async function nameTaken(ctx: CommandContext, guildId: string, name: string, exceptId?: string): Promise<boolean> {
  const clash = await ctx.app.prisma.server.findFirst({
    where: { guildId, name: { equals: name, mode: "insensitive" }, ...(exceptId ? { NOT: { id: exceptId } } : {}) }
  });
  if (clash) await respond(ctx, failure(`A server named **${clash.name}** already exists.`, "Name in use"));
  return Boolean(clash);
}

function cleanHost(value: string | null | undefined): string | undefined {
  const host = value?.trim().toLowerCase();
  return host ? host : undefined;
}

/** Replies and returns false when any provided host/port is invalid. */
async function validateAddresses(
  ctx: CommandContext,
  hosts: Array<string | undefined>,
  ports: Array<number | undefined>
): Promise<boolean> {
  const badHost = hosts.find((host) => host !== undefined && !isValidHost(host));
  const badPort = ports.find((port) => port !== undefined && !isValidPort(port));
  if (badHost === undefined && badPort === undefined) return true;

  await respond(
    ctx,
    failure(
      badHost !== undefined
        ? `\`${badHost}\` isn't a valid hostname or IP address.`
        : "Ports must be whole numbers between 1 and 65535.",
      "Invalid address"
    )
  );
  return false;
}

function optionalNumber(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  return Number(value);
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
        .setDescription("Register a Minecraft server (Java, with optional Bedrock)")
        .addStringOption((opt) =>
          opt.setName("name").setDescription("Display name, e.g. Omegle MC").setRequired(true).setMaxLength(32)
        )
        .addStringOption((opt) =>
          opt.setName("host").setDescription("Java IP / hostname").setRequired(true).setMaxLength(253)
        )
        .addIntegerOption((opt) =>
          opt.setName("port").setDescription(`Java port (default ${DEFAULT_JAVA_PORT})`).setMinValue(1).setMaxValue(65535)
        )
        .addIntegerOption((opt) =>
          opt.setName("bedrock_port").setDescription("Bedrock port — adds Bedrock support").setMinValue(1).setMaxValue(65535)
        )
        .addStringOption((opt) =>
          opt.setName("bedrock_host").setDescription("Bedrock IP, if different from the Java IP").setMaxLength(253)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName("edit")
        .setDescription("Change a server's name or addresses")
        .addStringOption((opt) => opt.setName("name").setDescription("Server to edit").setRequired(true).setAutocomplete(true))
        .addStringOption((opt) => opt.setName("rename").setDescription("New display name").setMaxLength(32))
        .addStringOption((opt) => opt.setName("host").setDescription("New Java IP / hostname").setMaxLength(253))
        .addIntegerOption((opt) => opt.setName("port").setDescription("New Java port").setMinValue(1).setMaxValue(65535))
        .addIntegerOption((opt) =>
          opt.setName("bedrock_port").setDescription("New Bedrock port (adds Bedrock if not set)").setMinValue(1).setMaxValue(65535)
        )
        .addStringOption((opt) =>
          opt.setName("bedrock_host").setDescription("New Bedrock IP, if different from the Java IP").setMaxLength(253)
        )
        .addBooleanOption((opt) => opt.setName("remove_bedrock").setDescription("Remove the Bedrock address"))
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
      // Prefix: server add "<name>" <host> [port] [bedrock-port]
      const name = normalizeName((options ? options.getString("name", true) : ctx.args[1]) ?? "");
      const host = cleanHost(options ? options.getString("host", true) : ctx.args[2]);
      const port = optionalNumber(options ? options.getInteger("port") : ctx.args[3]) ?? DEFAULT_JAVA_PORT;
      const bedrockPort = optionalNumber(options ? options.getInteger("bedrock_port") : ctx.args[4]);
      const bedrockHost = cleanHost(options?.getString("bedrock_host"));

      if (!name || !host) {
        await respond(ctx, usage('server add "<name>" <host> [java-port] [bedrock-port]'));
        return;
      }
      if (!SERVER_NAME_PATTERN.test(name)) {
        await respond(ctx, failure(NAME_RULES, "Invalid name"));
        return;
      }
      if (bedrockHost && bedrockPort === undefined) {
        await respond(ctx, failure("Set `bedrock_port` too when adding a Bedrock address.", "Missing Bedrock port"));
        return;
      }
      if (!(await validateAddresses(ctx, [host, bedrockHost], [port, bedrockPort]))) return;
      if (await nameTaken(ctx, guildId, name)) return;

      const server = await p.server.create({
        data: {
          guildId,
          name,
          host,
          port,
          bedrockPort: bedrockPort ?? null,
          // Only store a Bedrock host when it differs from the Java one.
          bedrockHost: bedrockPort !== undefined && bedrockHost && bedrockHost !== host ? bedrockHost : null
        }
      });
      await respond(ctx, serverDetailView(server, "✅ Server added — next, try `/status enable` or `/bridge enable`."));
      return;
    }

    if (action === "edit") {
      // Prefix: server edit "<name>" [host] [port] ["new name"]
      const name = options ? options.getString("name", true) : ctx.args[1];
      const host = cleanHost(options ? options.getString("host") : ctx.args[2]);
      const port = optionalNumber(options ? options.getInteger("port") : ctx.args[3]);
      const rename = normalizeName((options ? options.getString("rename") : ctx.args[4]) ?? "") || undefined;
      const bedrockPort = optionalNumber(options?.getInteger("bedrock_port"));
      const bedrockHost = cleanHost(options?.getString("bedrock_host"));
      const removeBedrock = options?.getBoolean("remove_bedrock") ?? false;

      if (!name) {
        await respond(ctx, usage('server edit "<name>" [host] [port] ["new name"]'));
        return;
      }

      const server = await findServerOrReply(ctx, guildId, name);
      if (!server) return;

      const nothingToChange =
        !host && port === undefined && !rename && bedrockPort === undefined && !bedrockHost && !removeBedrock;
      if (nothingToChange) {
        await respond(ctx, info("Nothing to change", "Provide at least one new value, e.g. `rename`, `host` or `bedrock_port`."));
        return;
      }
      if (removeBedrock && (bedrockPort !== undefined || bedrockHost)) {
        await respond(ctx, failure("Use either `remove_bedrock` or new Bedrock values, not both.", "Conflicting options"));
        return;
      }
      if (bedrockHost && bedrockPort === undefined && server.bedrockPort === null) {
        await respond(ctx, failure("This server has no Bedrock port yet — set `bedrock_port` too.", "Missing Bedrock port"));
        return;
      }
      if (rename && !SERVER_NAME_PATTERN.test(rename)) {
        await respond(ctx, failure(NAME_RULES, "Invalid name"));
        return;
      }
      if (!(await validateAddresses(ctx, [host, bedrockHost], [port, bedrockPort]))) return;
      if (rename && (await nameTaken(ctx, guildId, rename, server.id))) return;

      const javaHost = host ?? server.host;
      const nextBedrockHost = bedrockHost ?? server.bedrockHost;

      const updated = await p.server.update({
        where: { id: server.id },
        data: {
          name: rename ?? server.name,
          host: javaHost,
          port: port ?? server.port,
          bedrockPort: removeBedrock ? null : bedrockPort ?? server.bedrockPort,
          bedrockHost: removeBedrock || !nextBedrockHost || nextBedrockHost === javaHost ? null : nextBedrockHost
        }
      });

      ctx.app.statusMonitor.refresh(updated.id).catch(() => undefined);
      await respond(ctx, serverDetailView(updated, "✅ Server updated"));
      return;
    }

    if (action === "delete") {
      const name = options ? options.getString("name", true) : ctx.args[1];
      if (!name) {
        await respond(ctx, usage('server delete "<name>"'));
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
          ? info("No servers yet", "Add one with `/server add`.")
          : serverListView(servers)
      );
      return;
    }

    await respond(
      ctx,
      usage(
        'server add "<name>" <host> [java-port] [bedrock-port]',
        'server edit "<name>" [host] [port] ["new name"]',
        'server delete "<name>"',
        "server list"
      )
    );
  }
} satisfies AppCommand;
