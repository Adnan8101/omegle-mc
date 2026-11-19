import { WhitelistRequestStatus } from "@prisma/client";
import { CommandContext } from "../types";
import { failure, success, usage, warning } from "../ui/components";
import { getMember, getUser, requireGuild, respond } from "../utils/context";
import { hasWhitelistAccess, ReviewDecision, reviewRequest } from "../whitelist/service";
import { parseUserMention } from "./shared";

/** Shared implementation of /verify and /reject. */
export async function runReviewCommand(ctx: CommandContext, type: ReviewDecision["type"]): Promise<void> {
  const guildId = await requireGuild(ctx);
  if (!guildId) return;

  if (!(await hasWhitelistAccess(ctx.app, guildId, await getMember(ctx)))) {
    await respond(ctx, failure("Only whitelist moderators can review requests.", "Missing permission"));
    return;
  }

  const options = ctx.interaction?.options;
  const targetId = options ? options.getUser("user", true).id : parseUserMention(ctx.args[0]);
  const reason = options ? options.getString("reason")?.trim() ?? "" : ctx.args.slice(1).join(" ").trim();

  if (!targetId || (type === "reject" && reason.length < 3)) {
    await respond(ctx, usage(type === "approve" ? "verify @user" : "reject @user <reason>"));
    return;
  }

  const pending = await ctx.app.prisma.whitelistRequest.findFirst({
    where: { guildId, userId: targetId, status: WhitelistRequestStatus.PENDING },
    orderBy: { createdAt: "desc" }
  });

  if (!pending) {
    await respond(ctx, warning("No pending request", `<@${targetId}> doesn't have a request waiting for review.`));
    return;
  }

  const guild = ctx.interaction?.guild ?? ctx.message?.guild;
  if (!guild) return;

  const result = await reviewRequest(ctx.app, {
    guild,
    requestId: pending.id,
    reviewer: getUser(ctx),
    decision: type === "approve" ? { type } : { type, reason: reason.slice(0, 300) }
  });

  if (!result.ok) {
    await respond(ctx, warning("Nothing to do", result.reason));
    return;
  }

  await respond(
    ctx,
    type === "approve"
      ? success("Request approved", `<@${result.value.userId}> (\`${result.value.username}\`) has been whitelisted.`)
      : success("Request rejected", `<@${result.value.userId}> (\`${result.value.username}\`) has been notified.`)
  );
}
