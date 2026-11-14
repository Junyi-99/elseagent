import type { Codex, ThreadOptions } from "@openai/codex-sdk";
import type { Reply, ReplyTarget } from "../slack/index.ts";
import type { QueuedMessage, SessionStore } from "../state/index.ts";
import type { TurnRunner } from "./scheduler.ts";

/** Reactions on the user's message that show where it is. */
export const REACTIONS = {
  queued: "hourglass_flowing_sand",
  working: "eyes",
  done: "white_check_mark",
  failed: "x",
} as const;

export interface TurnDeps {
  codex: Pick<Codex, "startThread" | "resumeThread">;
  sessions: Pick<SessionStore, "threadFor" | "touch">;
  threadOptions: ThreadOptions;
  replyTo(target: ReplyTarget): Reply;
  turnTimeoutMs: number;
  sessionIdleMs: number;
  logger?: Pick<Console, "warn">;
}

/** What Codex sees for a Slack message: who said it, then the text. */
export function formatInput(message: Pick<QueuedMessage, "user" | "text">): string {
  return `<@${message.user}>: ${message.text}`;
}

/**
 * Run one Codex turn for a queued Slack message: continue the conversation's Codex thread (or
 * start one), stop it after the timeout or on shutdown, and post the outcome back to Slack.
 */
export function createTurnRunner(deps: TurnDeps): TurnRunner {
  const { codex, sessions, threadOptions, turnTimeoutMs, sessionIdleMs, logger = console } = deps;

  return async (message, shutdown) => {
    const reply = deps.replyTo(message);
    await reply.unreact(REACTIONS.queued);
    await reply.react(REACTIONS.working);

    const existing = sessions.threadFor(message.conversationKey, sessionIdleMs);
    const thread = existing
      ? codex.resumeThread(existing, threadOptions)
      : codex.startThread(threadOptions);
    const timeout = AbortSignal.timeout(turnTimeoutMs);

    let outcome: keyof typeof REACTIONS = "failed";
    try {
      const turn = await thread.run(formatInput(message), {
        signal: AbortSignal.any([timeout, shutdown]),
      });
      await reply.post(turn.finalResponse.trim() || "_(no response)_");
      outcome = "done";
    } catch (err) {
      if (shutdown.aborted) {
        await reply.post("The agent restarted while working on this. Send it again to retry.");
      } else if (timeout.aborted) {
        await reply.post(
          `Stopped: this took longer than ${Math.round(turnTimeoutMs / 60_000)} minutes. ` +
            "The conversation is kept, so you can follow up.",
        );
      } else {
        logger.warn(`codex: turn failed for ${message.conversationKey}: ${(err as Error).message}`);
        await reply.post(`Codex failed: ${(err as Error).message}`);
      }
    } finally {
      // Keep the mapping even after a failure: the thread holds whatever context was built.
      if (thread.id) sessions.touch(message.conversationKey, thread.id);
      await reply.unreact(REACTIONS.working);
      await reply.react(REACTIONS[outcome]);
    }
  };
}
