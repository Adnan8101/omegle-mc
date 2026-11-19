import { InteractionContextType, SlashCommandBuilder } from "discord.js";
import { AppCommand } from "../types";
import { runReviewCommand } from "./review";

export default {
  name: "verify",
  description: "Approve a member's pending whitelist request",
  aliases: ["approve"],
  slash: new SlashCommandBuilder()
    .setName("verify")
    .setDescription("Approve a member's pending whitelist request")
    .setContexts(InteractionContextType.Guild)
    .addUserOption((opt) => opt.setName("user").setDescription("Member to approve").setRequired(true)),
  execute: (ctx) => runReviewCommand(ctx, "approve")
} satisfies AppCommand;
