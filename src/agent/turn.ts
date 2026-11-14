import type { Codex, ThreadOptions } from "@openai/codex-sdk";
import type { ContextMessage, Reply, ReplyTarget, ThreadContext } from "../slack/index.ts";
import type { QueuedMessage, SessionStore } from "../state/index.ts";
import { parseReply, REPLY_SCHEMA } from "./reply.ts";
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
  sessions: Pick<SessionStore, "get" | "touch">;
  threadOptions: ThreadOptions;
  replyTo(target: ReplyTarget): Reply;
  /** Thread messages after `afterTs` (null: from the start) and before the message itself. */
  threadContext(message: QueuedMessage, afterTs: string | null): Promise<ThreadContext>;
  turnTimeoutMs: number;
  sessionIdleMs: number;
  logger?: Pick<Console, "warn">;
}

const line = (m: ContextMessage) => `<@${m.user}>: ${m.text}`;

/** What Codex sees: thread messages it hasn't seen yet, then the message addressed to it. */
export function formatInput(
  message: Pick<QueuedMessage, "user" | "text">,
  context: ThreadContext,
): string {
  const current = line(message);
  if (context.messages.length === 0) return current;
  const omitted = context.omitted ? `(${context.omitted} earlier messages omitted)\n` : "";
  return [
    "Messages in this thread since your last reply:",
    omitted + context.messages.map(line).join("\n"),
    "",
    "Message for you:",
    current,
  ].join("\n");
}

/**
 * Run one Codex turn for a queued Slack message: continue the conversation's Codex thread (or
 * start one) with the thread messages it hasn't seen, stop it after the timeout or on shutdown,
 * and post the reply (with choice buttons) back to Slack.
 */
export function createTurnRunner(deps: TurnDeps): TurnRunner {
  const { codex, sessions, threadOptions, turnTimeoutMs, sessionIdleMs, logger = console } = deps;

  return async (message, shutdown) => {
    const reply = deps.replyTo(message);
    await reply.unreact(REACTIONS.queued);
    await reply.react(REACTIONS.working);

    const session = sessions.get(message.conversationKey, sessionIdleMs);
    const thread = session
      ? codex.resumeThread(session.threadId, threadOptions)
      : codex.startThread(threadOptions);
    const timeout = AbortSignal.timeout(turnTimeoutMs);

    let outcome: keyof typeof REACTIONS = "failed";
    try {
      // A new session gets the whole thread so far; a continuing one only what it hasn't seen.
      const context = await deps
        .threadContext(message, session?.lastSeenTs ?? null)
        .catch((err: Error): ThreadContext => {
          logger.warn(`slack: could not read thread context: ${err.message}`);
          return { messages: [], omitted: 0 };
        });
      const turn = await thread.run(formatInput(message, context), {
        outputSchema: REPLY_SCHEMA,
        signal: AbortSignal.any([timeout, shutdown]),
      });
      const { message: text, choices } = parseReply(turn.finalResponse);
      await reply.post(text.trim() || "_(no response)_", choices);
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
      if (thread.id) sessions.touch(message.conversationKey, thread.id, message.ts);
      await reply.unreact(REACTIONS.working);
      await reply.react(REACTIONS[outcome]);
    }
  };
}
