import { ButtonBuilder, ButtonStyle, ContainerBuilder, escapeMarkdown, TextDisplayBuilder } from "discord.js";
import { WhitelistEdition, WhitelistRequest, WhitelistRequestStatus } from "@prisma/client";
import { bullet, Card, timestamp, truncate, V2Component } from "../ui/components";
import { Colors, Emojis, Icons } from "../ui/theme";

// Custom IDs are unchanged from earlier versions so already-posted panels keep working.
export const WhitelistIds = {
  startJava: "whitelist:start:java",
  startBedrock: "whitelist:start:bedrock",
  checkStatus: "whitelist:status",
  submitModalPrefix: "whitelist:submit:",
  approvePrefix: "whitelist:approve:",
  rejectPrefix: "whitelist:reject:",
  rejectModalPrefix: "whitelist:reject-modal:"
} as const;

export function formatEdition(edition: WhitelistEdition): string {
  return edition === WhitelistEdition.BEDROCK ? `${Icons.bedrock} Bedrock Edition` : `${Icons.java} Java Edition`;
}

const statusMeta: Record<WhitelistRequestStatus, { label: string; icon: string; color: number }> = {
  PENDING: { label: "Awaiting review", icon: Icons.pending, color: Colors.warning },
  APPROVED: { label: "Approved", icon: Icons.success, color: Colors.success },
  REJECTED: { label: "Rejected", icon: Icons.error, color: Colors.danger }
};

/** Public panel posted in the request channel. */
export function panelView(guildName: string, guildIcon: string | null): ContainerBuilder {
  return new Card(Colors.minecraft)
    .header(`${Emojis.minecraft} Server Whitelist`, {
      subtitle: `Request access to the **${escapeMarkdown(guildName)}** Minecraft server.`,
      thumbnail: guildIcon
    })
    .divider()
    .text(
      "### How it works",
      bullet("Choose your edition below."),
      bullet("Enter your exact in-game username."),
      bullet("A staff member reviews your request — we'll DM you the result.")
    )
    .divider()
    .actions(
      new ButtonBuilder()
        .setCustomId(WhitelistIds.startJava)
        .setLabel("Java Edition")
        .setEmoji(Icons.java)
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId(WhitelistIds.startBedrock)
        .setLabel("Bedrock Edition")
        .setEmoji(Icons.bedrock)
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId(WhitelistIds.checkStatus)
        .setLabel("Check my request")
        .setStyle(ButtonStyle.Secondary)
    )
    .footer("Keep your DMs open so we can notify you when your request is reviewed.")
    .build();
}

export type ReviewCardInput = {
  request: WhitelistRequest;
  applicantTag?: string;
  applicantAvatar?: string | null;
  modRoleIds?: string[];
  reason?: string | null;
};

/** Staff review card. Pending cards ping mod roles and carry approve/reject buttons. */
export function reviewCardView(input: ReviewCardInput): V2Component[] {
  const { request } = input;
  const meta = statusMeta[request.status];
  const isPending = request.status === WhitelistRequestStatus.PENDING;

  const card = new Card(meta.color)
    .header(`${Emojis.minecraft} Whitelist Request`, { subtitle: `Submitted ${timestamp(request.createdAt)}` })
    .divider()
    .block(
      [
        bullet(`**Applicant:** <@${request.userId}>${input.applicantTag ? ` · \`${escapeMarkdown(input.applicantTag)}\`` : ""}`),
        bullet(`**Username:** \`${request.username}\``),
        bullet(`**Edition:** ${formatEdition(request.edition)}`)
      ],
      input.applicantAvatar
    )
    .divider();

  if (isPending) {
    card
      .text(`${meta.icon} **${meta.label}**`)
      .actions(
        new ButtonBuilder()
          .setCustomId(`${WhitelistIds.approvePrefix}${request.id}`)
          .setLabel("Approve")
          .setEmoji(Icons.success)
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(`${WhitelistIds.rejectPrefix}${request.id}`)
          .setLabel("Reject")
          .setEmoji("✖️")
          .setStyle(ButtonStyle.Danger)
      );
  } else {
    card.text(
      `${meta.icon} **${meta.label}**${request.reviewedById ? ` by <@${request.reviewedById}>` : ""}${
        request.reviewedAt ? ` · ${timestamp(request.reviewedAt)}` : ""
      }`,
      input.reason ? `> ${escapeMarkdown(truncate(input.reason, 500)).replace(/\n/g, "\n> ")}` : null
    );
  }

  card.footer(`Request ID: ${request.id}`);

  const components: V2Component[] = [];
  if (isPending && input.modRoleIds?.length) {
    components.push(new TextDisplayBuilder().setContent(input.modRoleIds.map((id) => `<@&${id}>`).join(" ")));
  }
  components.push(card.build());
  return components;
}

/** Ephemeral view shown by the "Check my request" button. */
export function myRequestView(request: WhitelistRequest | null): ContainerBuilder {
  if (!request) {
    return new Card(Colors.neutral)
      .text("### No request found", "You haven't submitted a whitelist request yet. Pick your edition on the panel to get started.")
      .build();
  }

  const meta = statusMeta[request.status];
  return new Card(meta.color)
    .text(`### ${meta.icon} ${meta.label}`)
    .fields([
      ["Username", `\`${request.username}\``],
      ["Edition", formatEdition(request.edition)],
      ["Submitted", timestamp(request.createdAt)],
      request.reviewedAt ? ["Reviewed", timestamp(request.reviewedAt)] : null,
      request.status === WhitelistRequestStatus.REJECTED && request.reviewNote
        ? ["Reason", escapeMarkdown(truncate(request.reviewNote, 500))]
        : null
    ])
    .footer(request.status === WhitelistRequestStatus.REJECTED ? "You can submit a new request from the panel." : null)
    .build();
}

/** Direct messages sent to applicants. */
export const dmViews = {
  submitted(guildName: string, request: WhitelistRequest): ContainerBuilder {
    return new Card(Colors.brand)
      .text(
        "### 📨 Request received",
        `Your whitelist request for **${escapeMarkdown(guildName)}** is now waiting for staff review.`
      )
      .fields([
        ["Username", `\`${request.username}\``],
        ["Edition", formatEdition(request.edition)]
      ])
      .footer("We'll message you again as soon as it has been reviewed.")
      .build();
  },

  approved(guildName: string, request: WhitelistRequest): ContainerBuilder {
    return new Card(Colors.success)
      .text(
        `### ${Icons.success} You're whitelisted!`,
        `Your request for **${escapeMarkdown(guildName)}** was approved. You can join the server now — welcome aboard!`
      )
      .fields([
        ["Username", `\`${request.username}\``],
        ["Edition", formatEdition(request.edition)]
      ])
      .build();
  },

  rejected(guildName: string, request: WhitelistRequest, reason: string): ContainerBuilder {
    return new Card(Colors.danger)
      .text(
        `### ${Icons.error} Request not approved`,
        `Your whitelist request for **${escapeMarkdown(guildName)}** was rejected.`
      )
      .fields([
        ["Username", `\`${request.username}\``],
        ["Reason", escapeMarkdown(truncate(reason, 500))]
      ])
      .footer("If you think this is a mistake, reach out to the server staff.")
      .build();
  }
};

/** Compact list of pending requests for staff. */
export function pendingListView(
  requests: WhitelistRequest[],
  total: number,
  staffChannelId: string,
  guildId: string
): ContainerBuilder {
  const card = new Card(total > 0 ? Colors.warning : Colors.success).header(`${Icons.pending} Pending requests`, {
    subtitle: total === 0 ? "The queue is empty — nothing to review." : `**${total}** request${total === 1 ? "" : "s"} waiting for review`
  });

  if (requests.length > 0) {
    card.divider().text(
      ...requests.map((request) => {
        const link = request.reviewMessageId
          ? ` · [Open](https://discord.com/channels/${guildId}/${staffChannelId}/${request.reviewMessageId})`
          : "";
        return `${Emojis.dot} ${formatEdition(request.edition).split(" ")[0]} \`${request.username}\` — <@${request.userId}> · ${timestamp(request.createdAt)}${link}`;
      })
    );
  }

  if (total > requests.length) {
    card.footer(`Showing the oldest ${requests.length} of ${total}.`);
  }

  return card.build();
}
