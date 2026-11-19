import dotenv from "dotenv";

dotenv.config();

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    return fallback;
  }
  return value.trim();
}

function integer(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(optional(name, String(fallback)), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function bool(name: string, fallback: boolean): boolean {
  const value = optional(name, String(fallback)).toLowerCase();
  return ["1", "true", "yes", "on"].includes(value);
}

const auth = optional("MC_BOT_AUTH", "offline").toLowerCase();

export const env = {
  DISCORD_TOKEN: required("DISCORD_TOKEN"),
  CLIENT_ID: optional("CLIENT_ID", ""),
  /** Checked at bot startup (not at import) so `npm run deploy` works without a database. */
  DATABASE_URL: optional("DATABASE_URL", ""),
  PREFIX: optional("PREFIX", "!"),

  /** How often status panels refresh. Clamped to 10s–1h to stay clear of rate limits. */
  STATUS_INTERVAL_SECONDS: integer("STATUS_INTERVAL_SECONDS", 30, 10, 3600),

  /** Chat bridge (Mineflayer) connection settings. */
  MC_BRIDGE_ENABLED: bool("MC_BRIDGE_ENABLED", true),
  MC_SERVER_HOST: optional("MC_SERVER_HOST", "127.0.0.1"),
  MC_JAVA_PORT: integer("MC_JAVA_PORT", 25565, 1, 65535),
  MC_BOT_USERNAME: optional("MC_BOT_USERNAME", "DiscordBridge"),
  MC_BOT_AUTH: (auth === "microsoft" ? "microsoft" : "offline") as "microsoft" | "offline"
};
