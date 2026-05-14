import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    return fallback;
  }
  return value;
}

export const env = {
  DISCORD_TOKEN: required("DISCORD_TOKEN"),
  CLIENT_ID: optional("CLIENT_ID", ""),
  DATABASE_URL: required("DATABASE_URL"),
  PREFIX: optional("PREFIX", "!"),
  MC_SERVER_HOST: optional("MC_SERVER_HOST", "127.0.0.1"),
  MC_SERVER_PORT: Number(optional("MC_SERVER_PORT", "19132")),
  MC_JAVA_PORT: Number(optional("MC_JAVA_PORT", "25565")),
  MC_BOT_USERNAME: optional("MC_BOT_USERNAME", "DiscordBridge")
};
