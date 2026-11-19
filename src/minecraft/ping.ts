import { ping as javaPing } from "minecraft-protocol";
import { logger } from "../utils/logger";

export type PingResult =
  | {
      online: true;
      edition: "java" | "bedrock";
      latencyMs: number;
      playersOnline: number;
      playersMax: number;
      motd: string;
      version?: string;
    }
  | { online: false };

const PING_TIMEOUT_MS = 6000;
const BEDROCK_PORTS = new Set([19132, 19133]);

function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new Error(`Ping timed out after ${ms}ms`));
    }, ms);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** Flattens a Java chat component (string | object | array) into plain text. */
function flattenChat(value: unknown): string {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return "";

  const parts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node) return;
    if (typeof node === "string") {
      parts.push(node);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (typeof node === "object") {
      const record = node as Record<string, unknown>;
      if (typeof record.text === "string") parts.push(record.text);
      if (Array.isArray(record.extra)) walk(record.extra);
      if (Array.isArray(record.with)) walk(record.with);
    }
  };

  walk(value);
  return parts.join("");
}

/** Removes § formatting codes and trims each line. */
export function cleanMotd(raw: string): string {
  return raw
    .replace(/§[0-9a-fk-orx]/gi, "")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

async function pingJava(host: string, port: number): Promise<PingResult> {
  const started = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any = await withTimeout(javaPing({ host, port, closeTimeout: PING_TIMEOUT_MS }), PING_TIMEOUT_MS);

  // minecraft-protocol returns the modern format (1.7+) or the legacy one.
  const isModern = typeof result?.players === "object";
  return {
    online: true,
    edition: "java",
    latencyMs: Number(result?.latency ?? Date.now() - started),
    playersOnline: Number(isModern ? result.players.online : result?.playerCount) || 0,
    playersMax: Number(isModern ? result.players.max : result?.maxPlayers) || 0,
    motd: cleanMotd(flattenChat(isModern ? result.description : result?.motd)),
    version: isModern ? result?.version?.name : result?.version
  };
}

async function pingBedrock(host: string, port: number): Promise<PingResult> {
  // jsp-raknet ships without types.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Client } = require("jsp-raknet");
  const client = new Client(host, port);
  // Without an error listener a DNS/socket failure would crash the process.
  client.socket.on("error", () => undefined);

  const close = () => {
    try {
      client.close();
    } catch {
      // already closed
    }
  };

  const started = Date.now();
  const advertisement = await withTimeout(
    new Promise<string>((resolve) => client.ping((serverName: string) => resolve(serverName))),
    PING_TIMEOUT_MS,
    close
  );
  close();

  // MCPE;<motd>;<protocol>;<version>;<online>;<max>;<guid>;<sub-motd>;...
  const parts = String(advertisement).split(";");
  return {
    online: true,
    edition: "bedrock",
    latencyMs: Date.now() - started,
    playersOnline: Number(parts[4]) || 0,
    playersMax: Number(parts[5]) || 0,
    motd: cleanMotd([parts[1], parts[7]].filter(Boolean).join("\n")),
    version: parts[3] || undefined
  };
}

/**
 * Pings a server as Java first, then Bedrock (or the other way round for
 * the standard Bedrock ports).
 */
export async function pingServer(host: string, port: number): Promise<PingResult> {
  const strategies = BEDROCK_PORTS.has(port) ? [pingBedrock, pingJava] : [pingJava, pingBedrock];

  for (const strategy of strategies) {
    try {
      return await strategy(host, port);
    } catch (error) {
      logger.debug({ host, port, strategy: strategy.name, error: (error as Error)?.message }, "Ping attempt failed");
    }
  }

  return { online: false };
}
