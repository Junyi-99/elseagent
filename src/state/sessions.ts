import { eq, lt } from "drizzle-orm";
import type { StateDb } from "./db.ts";
import { sessions } from "./schema.ts";

/** Maps a Slack conversation to the Codex thread that holds its context. */
export class SessionStore {
  constructor(
    private readonly db: StateDb,
    private readonly now: () => number = Date.now,
  ) {}

  /** The Codex thread for a conversation, unless it has been idle longer than `maxIdleMs`. */
  threadFor(conversationKey: string, maxIdleMs: number): string | null {
    const row = this.db
      .select()
      .from(sessions)
      .where(eq(sessions.conversationKey, conversationKey))
      .get();
    if (!row || row.lastActiveAt < this.now() - maxIdleMs) return null;
    return row.threadId;
  }

  /** Record activity on a conversation and the Codex thread it now uses. */
  touch(conversationKey: string, threadId: string): void {
    const lastActiveAt = this.now();
    this.db
      .insert(sessions)
      .values({ conversationKey, threadId, lastActiveAt })
      .onConflictDoUpdate({ target: sessions.conversationKey, set: { threadId, lastActiveAt } })
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
