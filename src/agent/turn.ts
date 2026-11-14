import type { Codex, Thread, ThreadItem, ThreadOptions, TurnOptions } from "@openai/codex-sdk";
import type { ContextMessage, Reply, ReplyTarget, ThreadContext } from "../slack/index.ts";
import type { QueuedMessage, SessionStore } from "../state/index.ts";
import { parseReply, REPLY_SCHEMA } from "./reply.ts";
import { stopReason, type TurnRunner } from "./scheduler.ts";
import { describeItem, StatusTicker, THINKING } from "./status.ts";

/** Reactions on the user's message that show where it is. */
export const REACTIONS = {
  queued: "hourglass_flowing_sand",
  working: "eyes",
  done: "white_check_mark",
  failed: "x",
} as const;

/**
 * Run a turn streamed, reporting each item as it starts, and return the final response.
 * Same result handling as the SDK's `Thread.run`.
 */
export async function runStreamed(
  thread: Pick<Thread, "runStreamed">,
  input: string,
  options: TurnOptions,
  onItemStarted: (item: ThreadItem) => void,
): Promise<string> {
  const { events } = await thread.runStreamed(input, options);
  let finalResponse = "";
  for await (const event of events) {
    if (event.type === "item.started") onItemStarted(event.item);
    else if (event.type === "item.completed" && event.item.type === "agent_message") {
      finalResponse = event.item.text;
    } else if (event.type === "turn.failed") throw new Error(event.error.message);
  }
  return finalResponse;
}

export interface TurnDeps {
  /** A Codex client for this turn (it carries the turn's identity to the elseagent MCP tools). */
  codexFor(message: QueuedMessage): Pick<Codex, "startThread" | "resumeThread">;
  /** Throttling of the thread's loading status (tests shorten it). */
  statusOptions?: ConstructorParameters<typeof StatusTicker>[1];
  sessions: Pick<SessionStore, "get" | "touch">;
  threadOptions: ThreadOptions;
  replyTo(target: ReplyTarget): Reply;
  /** Thread messages after `afterTs` (null: from the start) and before the message itself. */
  threadContext(message: QueuedMessage, afterTs: string | null): Promise<ThreadContext>;
  turnTimeoutMs: number;
  sessionIdleMs: number;
  logger?: Pick<Console, "warn">;
}

const NO_CONTEXT: ThreadContext = { messages: [], omitted: 0 };

const line = (m: ContextMessage) => `<@${m.user}>: ${m.text}`;

/**
 * What Codex sees: thread messages it hasn't seen yet, then the message addressed to it.
 * A scheduled run's text is the task description itself.
 */
export function formatInput(
  message: Pick<QueuedMessage, "user" | "text" | "scheduleId">,
  context: ThreadContext,
): string {
  if (message.scheduleId !== null) return message.text;
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
 * Run one Codex turn for a queued message.
 *
 * A Slack message continues its conversation's Codex thread (or starts one) with the thread
 * messages it hasn't seen, and the reply goes into that thread. A scheduled run always starts a
 * new Codex thread and posts its result as a new top-level message; replies in that message's
 * thread then continue the run's session like any conversation.
 */
export function createTurnRunner(deps: TurnDeps): TurnRunner {
  const { sessions, threadOptions, turnTimeoutMs, sessionIdleMs, logger = console } = deps;

  return async (message, signal) => {
    const scheduled = message.scheduleId !== null;
    const reply = deps.replyTo(message);
    const react = (name: string) => (scheduled ? Promise.resolve() : reply.react(name));
    const unreact = (name: string) => (scheduled ? Promise.resolve() : reply.unreact(name));
    await unreact(REACTIONS.queued);
    await react(REACTIONS.working);

    const codex = deps.codexFor(message);
    const session = scheduled ? null : sessions.get(message.conversationKey, sessionIdleMs);
    const thread = session
      ? codex.resumeThread(session.threadId, threadOptions)
      : codex.startThread(threadOptions);
    const timeout = AbortSignal.timeout(turnTimeoutMs);

    // Where the conversation continues: the user's thread, or the scheduled run's new message.
    let conversation: { key: string; lastSeenTs: string } | null = scheduled
      ? null
      : { key: message.conversationKey, lastSeenTs: message.ts };
    const postAndTrack = async (text: string, choices: string[] = []) => {
      const ts = await reply.post(text, choices);
      if (scheduled && ts && !conversation) {
        conversation = { key: `${message.channel}:${ts}`, lastSeenTs: ts };
      }
    };

    // The "is thinking…" line at the bottom of the thread (none for scheduled runs).
    const status = new StatusTicker((text) => reply.setStatus(text), deps.statusOptions);
    if (!scheduled) status.set(THINKING);

    let outcome: keyof typeof REACTIONS = "failed";
    try {
      // A new session gets the whole thread so far; a continuing one only what it hasn't seen.
      const context = scheduled
        ? NO_CONTEXT
        : await deps
            .threadContext(message, session?.lastSeenTs ?? null)
            .catch((err: Error): ThreadContext => {
              logger.warn(`slack: could not read thread context: ${err.message}`);
              return NO_CONTEXT;
            });
      const finalResponse = await runStreamed(
        thread,
        formatInput(message, context),
        { outputSchema: REPLY_SCHEMA, signal: AbortSignal.any([timeout, signal]) },
        (item) => {
          const text = !scheduled && describeItem(item);
          if (text) status.set(text);
        },
      );
      await status.stop();
      const { message: text, choices } = parseReply(finalResponse);
      await postAndTrack(text.trim() || "_(no response)_", choices);
      outcome = "done";
    } catch (err) {
      const stopped = stopReason(signal);
      if (stopped?.kind === "cancelled") {
        await postAndTrack(`Stopped by <@${stopped.by}>.`);
      } else if (stopped?.kind === "shutdown") {
        await postAndTrack("The agent restarted while working on this. Send it again to retry.");
      } else if (timeout.aborted) {
        await postAndTrack(
          `Stopped: this took longer than ${Math.round(turnTimeoutMs / 60_000)} minutes. ` +
            "The conversation is kept, so you can follow up.",
        );
      } else {
        logger.warn(`codex: turn failed for ${message.conversationKey}: ${(err as Error).message}`);
        await postAndTrack(`Codex failed: ${(err as Error).message}`);
      }
    } finally {
      await status.stop();
      // Keep the mapping even after a failure: the thread holds whatever context was built.
      const where = conversation as { key: string; lastSeenTs: string } | null;
      if (thread.id && where) sessions.touch(where.key, thread.id, where.lastSeenTs);
      await unreact(REACTIONS.working);
      await react(REACTIONS[outcome]);
    }
  };
}
