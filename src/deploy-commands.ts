/**
 * Registers every slash command globally (all servers the bot is in).
 * Usage: npm run deploy
 */
import { REST, Routes } from "discord.js";
import { env } from "./config/env";
import { slashCommandData } from "./commands";

async function main(): Promise<void> {
  if (!env.CLIENT_ID) {
    throw new Error("CLIENT_ID is missing from .env");
  }

  const body = slashCommandData();
  const rest = new REST().setToken(env.DISCORD_TOKEN);

  console.log(`Deploying ${body.length} slash commands globally…`);
  const result = (await rest.put(Routes.applicationCommands(env.CLIENT_ID), { body })) as Array<{ name: string }>;
  console.log(`Deployed: ${result.map((command) => `/${command.name}`).join(", ")}`);
}

main().catch((error) => {
  console.error("Deploy failed:", error?.message ?? error);
  process.exit(1);
});
