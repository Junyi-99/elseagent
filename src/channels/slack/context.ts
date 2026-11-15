import type { ContextMessage, ThreadContext } from "../types.ts";
import { type SlackFile, slackFiles } from "./message.ts";

/** The subset of the Slack WebClient used to read a thread (kept small for testing). */
export interface RepliesClient {
  conversations: {
    replies(args: {
      channel: string;
      ts: string;
      oldest?: string;
      latest?: string;
      inclusive?: boolean;
      limit?: number;
      cursor?: string;
    }): Promise<{
      messages?: {
        user?: string;
        bot_id?: string;
        text?: string;
        ts?: string;
        subtype?: string;
        files?: SlackFile[];
      }[];
      response_metadata?: { next_cursor?: string };
    }>;
  };
}

/** At most this many context messages are sent to Codex; older ones are summarized as a count. */
export const MAX_CONTEXT_MESSAGES = 50;

/**
 * Messages in a thread strictly between `afterTs` (the last one Codex saw; omit for the whole
 * thread) and `beforeTs` (the message being handled), excluding the agent's own messages.
 */
export async function fetchThreadContext(
  client: RepliesClient,
  args: { channel: string; threadTs: string; afterTs?: string | null; beforeTs: string },
  botUserId: string,
): Promise<ThreadContext> {
  const all: ContextMessage[] = [];
  let cursor: string | undefined;
  do {
    const res = await client.conversations.replies({
      channel: args.channel,
      ts: args.threadTs,
      oldest: args.afterTs ?? undefined,
      latest: args.beforeTs,
      inclusive: false,
      limit: 200,
      cursor,
    });
    for (const m of res.messages ?? []) {
      // replies() always returns the thread's parent first; respect the window ourselves.
      if (!m.ts || (args.afterTs && m.ts <= args.afterTs) || m.ts >= args.beforeTs) continue;
      const files = slackFiles(m.files);
      if (m.user === botUserId || (!m.text && files.length === 0)) continue;
      all.push({
        user: m.user ?? `bot ${m.bot_id ?? "unknown"}`,
        text: m.text ?? "",
        ...(files.length > 0 ? { files } : {}),
      });
    }
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);

  const omitted = Math.max(0, all.length - MAX_CONTEXT_MESSAGES);
  return { messages: all.slice(omitted), omitted };
}
