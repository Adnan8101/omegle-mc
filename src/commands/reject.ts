import { InteractionContextType, SlashCommandBuilder } from "discord.js";
import { AppCommand } from "../types";
import { runReviewCommand } from "./review";

export default {
  name: "reject",
  description: "Reject a member's pending whitelist request",
  slash: new SlashCommandBuilder()
    .setName("reject")
    .setDescription("Reject a member's pending whitelist request")
    .setContexts(InteractionContextType.Guild)
    .addUserOption((opt) => opt.setName("user").setDescription("Member to reject").setRequired(true))
    .addStringOption((opt) =>
      opt.setName("reason").setDescription("Shared with the member").setRequired(true).setMinLength(3).setMaxLength(300)
    ),
  execute: (ctx) => runReviewCommand(ctx, "reject")
} satisfies AppCommand;
