import { eq, lt } from "drizzle-orm";
import type { StateDb } from "./db.ts";
import { sessions } from "./schema.ts";

export interface SessionInfo {
  threadId: string;
  /** Slack ts of the last message Codex has seen in this conversation. */
  lastSeenTs: string | null;
}

/** Maps a Slack conversation to the Codex thread that holds its context. */
export class SessionStore {
  constructor(
    private readonly db: StateDb,
    private readonly now: () => number = Date.now,
  ) {}

  /** The conversation's session, unless it has been idle longer than `maxIdleMs`. */
  get(conversationKey: string, maxIdleMs: number): SessionInfo | null {
    const row = this.db
      .select()
      .from(sessions)
      .where(eq(sessions.conversationKey, conversationKey))
      .get();
    if (!row || row.lastActiveAt < this.now() - maxIdleMs) return null;
    return { threadId: row.threadId, lastSeenTs: row.lastSeenTs };
  }

  /** Record a turn: the Codex thread the conversation uses and the last Slack message it saw. */
  touch(conversationKey: string, threadId: string, lastSeenTs: string | null = null): void {
    const lastActiveAt = this.now();
    this.db
      .insert(sessions)
      .values({ conversationKey, threadId, lastActiveAt, lastSeenTs })
      .onConflictDoUpdate({
        target: sessions.conversationKey,
        set: { threadId, lastActiveAt, lastSeenTs },
      })
      .run();
  }

  /** Forget sessions idle longer than `maxIdleMs`. Returns how many were removed. */
  expire(maxIdleMs: number): number {
    return this.db
      .delete(sessions)
      .where(lt(sessions.lastActiveAt, this.now() - maxIdleMs))
      .returning({ key: sessions.conversationKey })
      .all().length;
  }
}
