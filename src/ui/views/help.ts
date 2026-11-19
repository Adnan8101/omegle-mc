import {
  ContainerBuilder,
  escapeMarkdown,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} from "discord.js";
import { Card } from "../components";
import { Colors, Icons } from "../theme";

export const HELP_SELECT_ID = "help:category";

type HelpCommand = {
  /** Slash usage, e.g. `/server add <name> <host> [port]` */
  usage: string;
  description: string;
};

type HelpCategory = {
  id: string;
  icon: string;
  title: string;
  summary: string;
  permission?: string;
  commands: HelpCommand[];
};

export const helpCategories: HelpCategory[] = [
  {
    id: "servers",
    icon: Icons.server,
    title: "Servers",
    summary: "Register the Minecraft servers this Discord tracks.",
    permission: "Manage Server",
    commands: [
      { usage: "/server add <name> <host> [port]", description: "Register a server. Port defaults to 25565." },
      { usage: "/server edit <name> [host] [port] [rename]", description: "Change a server's address or name." },
      { usage: "/server delete <name>", description: "Remove a server and its status panel." },
      { usage: "/server list", description: "Show every server with its panel and bridge state." }
    ]
  },
  {
    id: "status",
    icon: Icons.status,
    title: "Status panels",
    summary: "Live, auto-refreshing server status in any channel.",
    permission: "Manage Server",
    commands: [
      { usage: "/status enable <server> <channel>", description: "Post a live panel that refreshes automatically." },
      { usage: "/status disable <server>", description: "Remove the panel and stop monitoring." },
      { usage: "/status check <server>", description: "Ping the server right now (only you see the result)." },
      { usage: "/status show <server>", description: "View the panel's settings." }
    ]
  },
  {
    id: "bridge",
    icon: Icons.bridge,
    title: "Chat bridge",
    summary: "Relay chat between a Discord channel and Minecraft.",
    permission: "Manage Server",
    commands: [
      { usage: "/bridge enable <server> <channel>", description: "Relay messages both ways through that channel." },
      { usage: "/bridge disable <server>", description: "Stop relaying chat." },
      { usage: "/bridge info", description: "Show the bridge connection and bridged channels." }
    ]
  },
  {
    id: "whitelist",
    icon: Icons.whitelist,
    title: "Whitelist",
    summary: "Members request access, staff approve or reject.",
    commands: [
      { usage: "/whitelist setup <request_channel> <staff_channel>", description: "Post the request panel. Requires Administrator." },
      { usage: "/whitelist info", description: "Show channels, reviewer roles and request counts." },
      { usage: "/whitelist pending", description: "List requests waiting for review." },
      { usage: "/whitelist mod-role <add|remove|show> [role]", description: "Choose who can review. Requires Manage Server." },
      { usage: "/verify <user>", description: "Approve a member's pending request." },
      { usage: "/reject <user> <reason>", description: "Reject a request; the reason is sent to the member." }
    ]
  },
  {
    id: "utility",
    icon: Icons.utility,
    title: "Utility",
    summary: "Bot health and this help page.",
    commands: [
      { usage: "/help [category]", description: "Show this help page." },
      { usage: "/utility ping", description: "Gateway latency and bridge connection." },
      { usage: "/utility uptime", description: "How long the bot has been running." }
    ]
  }
];

export type HelpViewInput = {
  botName: string;
  avatar: string | null;
  prefix: string;
  /** Category id to show; omitted for the overview. */
  category?: string | null;
};

/** Turns `/server add <name>` into the prefix form `!server add <name>`. */
function toPrefix(usage: string, prefix: string): string {
  return usage.replace(/^\//, prefix);
}

function categorySelect(selected?: string): StringSelectMenuBuilder {
  return new StringSelectMenuBuilder()
    .setCustomId(HELP_SELECT_ID)
    .setPlaceholder("Browse a category…")
    .addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel("Overview")
        .setValue("overview")
        .setDescription("All categories at a glance")
        .setEmoji("🏠")
        .setDefault(!selected),
      ...helpCategories.map((category) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(category.title)
          .setValue(category.id)
          .setDescription(category.summary.slice(0, 100))
          .setEmoji(category.icon)
          .setDefault(category.id === selected)
      )
    );
}

export function helpView(input: HelpViewInput): ContainerBuilder {
  const category = helpCategories.find((entry) => entry.id === input.category);
  const name = escapeMarkdown(input.botName);

  if (!category) {
    const total = helpCategories.reduce((sum, entry) => sum + entry.commands.length, 0);
    const card = new Card(Colors.brand)
      .header(`${name} · Help`, {
        subtitle: `Minecraft server tools for Discord: status panels, chat bridge and whitelist. **${total} commands** in ${helpCategories.length} categories.`,
        thumbnail: input.avatar
      })
      .divider();

    card.text(
      helpCategories
        .map(
          (entry) =>
            `${entry.icon} **${entry.title}**${entry.permission ? `  \`${entry.permission}\`` : ""}\n-# ${entry.summary} · ${entry.commands.length} commands`
        )
        .join("\n\n")
    );

    return card
      .divider()
      .selectMenu(categorySelect())
      .footer(`Tip: every command also works with the \`${input.prefix}\` prefix, e.g. \`${input.prefix}server list\`.`)
      .build();
  }

  const card = new Card(Colors.brand)
    .header(`${category.icon} ${category.title}`, {
      subtitle: [category.summary, category.permission ? `Requires **${category.permission}**.` : null]
        .filter(Boolean)
        .join(" "),
      thumbnail: input.avatar
    })
    .divider();

  card.text(
    category.commands
      .map((command) => `**\`${command.usage}\`**\n${command.description}\n-# Prefix: \`${toPrefix(command.usage, input.prefix)}\``)
      .join("\n\n")
  );

  return card
    .divider()
    .selectMenu(categorySelect(category.id))
    .footer("`<required>` · `[optional]`")
    .build();
}
