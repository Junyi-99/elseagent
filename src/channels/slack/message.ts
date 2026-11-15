import type { KnownEventFromType, types } from "@slack/bolt";
import type { IncomingMessage } from "../types.ts";

type AppMentionEvent = types.AppMentionEvent;

type MessageEvent = KnownEventFromType<"message">;

export { conversationKey } from "../types.ts";

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

/** A slash command in a DM, as a message without a Slack message behind it (empty ts). */
export function slashCommandMessage(channel: string, user: string, text: string): IncomingMessage {
  return { channel, ts: "", threadTs: undefined, user, text, isDirect: true };
}
