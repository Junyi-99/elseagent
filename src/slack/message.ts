import type { KnownEventFromType, types } from "@slack/bolt";

type AppMentionEvent = types.AppMentionEvent;

type MessageEvent = KnownEventFromType<"message">;

/** A message addressed to the agent, normalized from a Slack event. */
export interface IncomingMessage {
  channel: string;
  /** Timestamp of the message itself (used for reactions). */
  ts: string;
  /**
   * Thread to reply in. Channel mentions always reply in a thread (starting one if needed).
   * Top-level DMs reply top-level, so this is undefined.
   */
  threadTs: string | undefined;
  user: string;
  /** Text with the agent's own @mention removed. */
  text: string;
  isDirect: boolean;
}

export function stripMention(text: string, botUserId: string): string {
  return text.replaceAll(`<@${botUserId}>`, "").replace(/\s+/g, " ").trim();
}

/** An @mention of the agent in a channel. Ignores other bots. */
export function fromMention(event: AppMentionEvent, botUserId: string): IncomingMessage | null {
  if (!event.user || event.bot_id || event.user === botUserId) return null;
  return {
    channel: event.channel,
    ts: event.ts,
    threadTs: event.thread_ts ?? event.ts,
    user: event.user,
    text: stripMention(event.text, botUserId),
    isDirect: false,
  };
}

/**
 * A plain user message in a DM with the agent. Channel messages are ignored here:
 * they reach the agent through `app_mention`, which would otherwise be handled twice.
 */
export function fromDirectMessage(event: MessageEvent, botUserId: string): IncomingMessage | null {
  if (event.subtype !== undefined || event.channel_type !== "im") return null;
  if (event.bot_id || event.user === botUserId) return null;
  return {
    channel: event.channel,
    ts: event.ts,
    threadTs: event.thread_ts,
    user: event.user,
    text: stripMention(event.text ?? "", botUserId),
    isDirect: true,
  };
}

/**
 * Identifies the conversation a message belongs to, which maps to one Codex session:
 * a thread (`channel:threadTs`), or a DM's top level (`channel`).
 */
export function conversationKey(message: Pick<IncomingMessage, "channel" | "threadTs">): string {
  return message.threadTs ? `${message.channel}:${message.threadTs}` : message.channel;
}
