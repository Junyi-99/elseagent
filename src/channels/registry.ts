import type { Channel, Reply, ReplyTarget, ThreadContext } from "./types.ts";

/**
 * The connected channels (Slack, Telegram), used as one: each call goes to the channel that owns
 * the chat ID involved.
 */
export class Channels {
  constructor(readonly all: Channel[]) {
    if (all.length === 0) throw new Error("no channel configured");
  }

  /** The channel a chat ID (a message's `channel`) belongs to. */
  for(chat: string): Channel {
    const channel = this.all.find((c) => c.owns(chat));
    if (!channel) {
      const known = this.all.map((c) => c.platform).join(", ");
      throw new Error(`${chat} doesn't belong to a connected channel (${known})`);
    }
    return channel;
  }

  replyTo = (target: ReplyTarget): Reply => this.for(target.channel).replyTo(target);

  threadContext = (
    message: { channel: string; ts: string; threadTs: string | null },
    afterTs: string | null,
  ): Promise<ThreadContext> => this.for(message.channel).threadContext(message, afterTs);

  ensureChannel = (ref: string): Promise<string> => this.for(ref).ensureChannel(ref);
}
