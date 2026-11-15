import type { Codex, Thread, ThreadItem, ThreadOptions, TurnOptions } from "@openai/codex-sdk";
import {
  type ContextMessage,
  NO_CONTEXT,
  type Reply,
  type ReplyTarget,
  type ThreadContext,
} from "../channels/types.ts";
import type { MessageQueue, QueuedMessage, SessionStore } from "../state/index.ts";
import { parseReply, REPLY_SCHEMA } from "./reply.ts";
import { stopReason, type TurnRunner } from "./scheduler.ts";
import { describeItem, StatusTicker, THINKING } from "./status.ts";

/**
 * Reactions on the user's message that show where it is. A successful turn just removes
 * "working": the reply itself says it's done.
 */
export const REACTIONS = {
  queued: "hourglass_flowing_sand",
  working: "eyes",
  failed: "x",
} as const;

/**
 * The `/new` slash command (DMs only): start the DM over with a new Codex session. It is
 * queued without a chat message (empty ts), unlike a user typing "/new" in a thread, which is
 * just text for Codex.
 */
export function isNewSessionCommand(
  message: Pick<QueuedMessage, "text" | "ts" | "scheduleId">,
): boolean {
  return message.scheduleId === null && message.ts === "" && message.text === "/new";
}

export const NEW_SESSION_REPLY =
  "Started a new session. I won't remember what we discussed before this point.";

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
  sessions: Pick<SessionStore, "get" | "touch" | "reset" | "replied">;
  /** To skip a passive message that a later queued message will see as context anyway. */
  queue: Pick<MessageQueue, "hasNewerPending">;
  threadOptions: ThreadOptions;
  replyTo(target: ReplyTarget): Reply;
  /** Thread messages after `afterTs` (null: from the start) and before the message itself. */
  threadContext(message: QueuedMessage, afterTs: string | null): Promise<ThreadContext>;
  turnTimeoutMs: number;
  sessionIdleMs: number;
  logger?: Pick<Console, "warn">;
}

const line = (m: ContextMessage) => `<@${m.user}>: ${m.text}`;

/** How a follow-up is introduced: a reply to the agent, which may be a mere acknowledgement. */
export const FOLLOWUP_LABEL =
  "Reply to your last message (no mention). Answer it; if it is only an acknowledgement " +
  "(thanks, ok) that needs no answer, set reply to false:";

/** How a passive message is introduced: Codex decides whether it is for it. */
export const PASSIVE_LABEL =
  "Latest message in the thread, not addressed to you. Reply only if it is meant for you or " +
  "you can really help; otherwise set reply to false:";

/**
 * What Codex sees: thread messages it hasn't seen yet, then the message addressed to it (or, for
 * a passive message, the latest one). A scheduled run's text is the task description itself.
 */
export function formatInput(
  message: Pick<QueuedMessage, "user" | "text" | "scheduleId" | "mode">,
  context: ThreadContext,
): string {
  if (message.scheduleId !== null) return message.text;
  const current = line(message);
  const label =
    message.mode === "passive"
      ? PASSIVE_LABEL
      : message.mode === "followup"
        ? FOLLOWUP_LABEL
        : "Message for you:";
  if (context.messages.length === 0) {
    return message.mode === "direct" ? current : `${label}\n${current}`;
  }
  const omitted = context.omitted ? `(${context.omitted} earlier messages omitted)\n` : "";
  return [
    "Messages in this thread since your last reply:",
    omitted + context.messages.map(line).join("\n"),
    "",
    label,
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
 *
 * A passive message (a thread reply that doesn't mention the agent) is quiet: no reactions, no
 * status, no error messages, and Codex may decide not to reply. It is skipped when the session
 * has already seen it or a later message of the conversation is queued.
 */
export function createTurnRunner(deps: TurnDeps): TurnRunner {
  const { sessions, threadOptions, turnTimeoutMs, sessionIdleMs, logger = console } = deps;

  return async (message, signal) => {
    const scheduled = message.scheduleId !== null;
    const passive = message.mode === "passive";
    const reply = deps.replyTo({ ...message, startsThread: scheduled });
    // Scheduled runs and slash commands have no user message to react to; passive messages
    // weren't addressed to the agent.
    const quiet = !message.ts || passive;
    const react = (name: string) => (quiet ? Promise.resolve() : reply.react(name));
    const unreact = (name: string) => (quiet ? Promise.resolve() : reply.unreact(name));
    await unreact(REACTIONS.queued);

    // Handled in the queue like any message, so it waits for a running turn in the same
    // conversation instead of racing it.
    if (isNewSessionCommand(message)) {
      sessions.reset(message.conversationKey, null);
      await reply.post(NEW_SESSION_REPLY);
      return;
    }
    const session = scheduled ? null : sessions.get(message.conversationKey, sessionIdleMs);
    if (
      passive &&
      ((session?.lastSeenTs && message.ts <= session.lastSeenTs) ||
        deps.queue.hasNewerPending(message.conversationKey, message.id))
    ) {
      return; // seen already, or a later turn will see it as context
    }
    await react(REACTIONS.working);

    const codex = deps.codexFor(message);
    const thread = session?.threadId
      ? codex.resumeThread(session.threadId, threadOptions)
      : codex.startThread(threadOptions);
    const timeout = AbortSignal.timeout(turnTimeoutMs);

    // Where the conversation continues: the user's thread, or the scheduled run's new message.
    let conversation: { key: string; lastSeenTs: string } | null = scheduled
      ? null
      : { key: message.conversationKey, lastSeenTs: message.ts };
    let replied = false;
    const postAndTrack = async (text: string, choices: string[] = []) => {
      const ts = await reply.post(text, choices);
      replied = true;
      if (scheduled && ts && !conversation) {
        conversation = { key: `${message.channel}:${ts}`, lastSeenTs: ts };
      }
    };

    // The "is thinking…" line at the bottom of the thread (none for scheduled runs, and none
    // for passive messages: the agent may not answer at all).
    const showStatus = !scheduled && !passive;
    const status = new StatusTicker((text) => reply.setStatus(text), deps.statusOptions);
    if (showStatus) status.set(THINKING);

    let failed = true;
    try {
      // A new session gets the whole thread so far; a continuing one only what it hasn't seen.
      const context = scheduled
        ? NO_CONTEXT
        : await deps
            .threadContext(message, session?.lastSeenTs ?? null)
            .catch((err: Error): ThreadContext => {
              logger.warn(`could not read thread context: ${err.message}`);
              return NO_CONTEXT;
            });
      const finalResponse = await runStreamed(
        thread,
        formatInput(message, context),
        { outputSchema: REPLY_SCHEMA, signal: AbortSignal.any([timeout, signal]) },
        (item) => {
          const text = showStatus && describeItem(item);
          if (text) status.set(text);
        },
      );
      await status.stop();
      const { reply: answer, message: text, choices } = parseReply(finalResponse);
      // Only a message the agent wasn't asked directly may go unanswered.
      if (answer || message.mode === "direct") {
        await postAndTrack(text.trim() || "_(no response)_", choices);
      }
      failed = false;
    } catch (err) {
      await status.stop();
      const stopped = stopReason(signal);
      if (stopped?.kind === "superseded") {
        // A direct message in this conversation took over; it sees this one as context.
      } else if (passive && stopped?.kind !== "cancelled") {
        // Nobody asked: don't post errors or timeouts into the thread.
        logger.warn(
          `codex: passive turn for ${message.conversationKey} ended: ${(err as Error).message}`,
        );
      } else if (stopped?.kind === "cancelled") {
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
      // A superseded turn records nothing, so the direct turn gets its message as context.
      const where = conversation as { key: string; lastSeenTs: string } | null;
      const superseded = stopReason(signal)?.kind === "superseded";
      if (thread.id && where && !superseded) sessions.touch(where.key, thread.id, where.lastSeenTs);
      if (replied && !scheduled) sessions.replied(message.conversationKey, message.user);
      await unreact(REACTIONS.working);
      if (failed && stopReason(signal)?.kind !== "superseded") await react(REACTIONS.failed);
    }
  };
}
