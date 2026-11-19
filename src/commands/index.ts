import { AppCommand } from "../types";
import bridgeCommand from "./bridge";
import helpCommand from "./help";
import rejectCommand from "./reject";
import serverCommand from "./server";
import statusCommand from "./status";
import utilityCommand from "./utility";
import verifyCommand from "./verify";
import whitelistCommand from "./whitelist";

export const commandList: AppCommand[] = [
  helpCommand,
  serverCommand,
  statusCommand,
  bridgeCommand,
  whitelistCommand,
  verifyCommand,
  rejectCommand,
  utilityCommand
];

/** Slash command payloads, ready to send to Discord. */
export function slashCommandData() {
  return commandList.filter((command) => command.slash).map((command) => command.slash!.toJSON());
}
