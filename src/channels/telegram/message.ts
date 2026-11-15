import { type IncomingMessage, TELEGRAM_PREFIX } from "../types.ts";
import type { TgMessage } from "./api.ts";

/** The channel ID of a Telegram chat. */
export const chatChannel = (chatId: number | string) => `${TELEGRAM_PREFIX}${chatId}`;

/** The Telegram chat ID of a channel, or null if it isn't a Telegram channel. */
export function chatIdOf(channel: string): number | null {
  if (!channel.startsWith(TELEGRAM_PREFIX)) return null;
  const id = Number(channel.slice(TELEGRAM_PREFIX.length));
  return Number.isSafeInteger(id) ? id : null;
}

/** The topic a message is in: each topic of a private chat is its own conversation. */
export const topicOf = (message: TgMessage): string | undefined =>
  message.is_topic_message && message.message_thread_id !== undefined
    ? String(message.message_thread_id)
    : undefined;

/** A bot command at the start of a message, e.g. `/new` or `/start@my_bot payload`. */
export function parseCommand(text: string): { command: string; args: string } | null {
  const match = /^\/([A-Za-z0-9_]+)(?:@[A-Za-z0-9_]+)?(?:\s+([\s\S]*))?$/.exec(text.trim());
  if (!match?.[1]) return null;
  return { command: match[1].toLowerCase(), args: match[2]?.trim() ?? "" };
}

/**
 * A user's message in a private chat with the bot. Group chats, other bots and messages
 * without text (or a caption) are ignored.
 */
export function fromTelegramMessage(message: TgMessage): IncomingMessage | null {
  if (message.chat.type !== "private" || !message.from || message.from.is_bot) return null;
  const text = (message.text ?? message.caption ?? "").trim();
  if (!text) return null;
  return {
    channel: chatChannel(message.chat.id),
    ts: String(message.message_id),
    threadTs: topicOf(message),
    user: String(message.from.id),
    text,
    isDirect: true,
  };
}

/** Telegram allows only a fixed set of reaction emoji; these stand in for the Slack names. */
export const REACTION_EMOJI: Record<string, string> = {
  hourglass_flowing_sand: "🫡",
  eyes: "👀",
  x: "😢",
};

/** The status line as a draft message: "is running `x`…" → "Running `x`…". */
export function statusText(status: string): string {
  const text = status.replace(/^is /, "");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** What /start says: the user's ID, and whether they may use the agent. */
export function startText(
  userId: string,
  allowed: boolean,
  { topicsEnabled }: { topicsEnabled: boolean },
): string {
  const id = `Your Telegram user ID is \`${userId}\`.`;
  if (!allowed) {
    return [
      id,
      "",
      "You're not on this agent's allow list yet. Ask whoever runs it to add your ID under " +
        "`channels.telegram.allowedUsers` in its config and restart it, then send me a message.",
    ].join("\n");
  }
  return [
    id,
    "",
    "You're all set: send me a message and I'll get to work.",
    topicsEnabled
      ? "Each topic (thread) in this chat is a separate conversation with its own session; " +
        "start a new topic for something new. `/new` starts the current one over."
      : "`/new` starts our conversation over with a new session.",
  ].join("\n");
}

export const NOT_ALLOWED_TEXT = (userId: string) =>
  `Sorry, you're not on this agent's allow list. Your Telegram user ID is \`${userId}\`; ` +
  "ask whoever runs the agent to add it under `channels.telegram.allowedUsers`.";
