import { count, desc, eq, lt, ne, sql } from "drizzle-orm";
import type { StateDb } from "./db.ts";
import { sessions } from "./schema.ts";

export interface SessionInfo {
  /** Null right after `/new`: the next turn starts a new Codex thread. */
  threadId: string | null;
  /** Slack ts of the last message Codex has seen in this conversation. */
  lastSeenTs: string | null;
}

/** Whether and how the agent follows a Slack thread (see agent/follow.ts). */
export interface FollowState {
  muted: boolean;
  /** Unix epoch ms the agent was last mentioned or replied; null if never. */
  lastAddressedAt: number | null;
  /** Unix epoch ms of the last turn. */
  lastActiveAt: number;
  /** Messages since the agent's last reply. */
  unanswered: number;
  /** Who the agent's last reply answered. */
  repliedTo: string | null;
}

/** Maps a conversation to the Codex thread that holds its context. */
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
    return { threadId: row.threadId || null, lastSeenTs: row.lastSeenTs };
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

  /**
   * Start a conversation over (`/new`): its next turn gets a new Codex thread. `fromTs` keeps
   * earlier thread messages out of the new session's context.
   */
  reset(conversationKey: string, fromTs: string | null): void {
    // An empty thread id marks "no Codex thread yet" (the column is NOT NULL).
    this.touch(conversationKey, "", fromTs);
  }

  /** The thread's follow state, or null if the agent has no session there. */
  followState(conversationKey: string): FollowState | null {
    const row = this.db
      .select({
        muted: sessions.muted,
        lastAddressedAt: sessions.lastAddressedAt,
        lastActiveAt: sessions.lastActiveAt,
        unanswered: sessions.unanswered,
        repliedTo: sessions.repliedTo,
      })
      .from(sessions)
      .where(eq(sessions.conversationKey, conversationKey))
      .get();
    return row ?? null;
  }

  /**
   * The agent was mentioned in a conversation: make sure it has a session row, so follow-ups are
   * followed even before the first turn ends, and note the time.
   */
  addressed(conversationKey: string): void {
    const now = this.now();
    this.db
      .insert(sessions)
      .values({ conversationKey, threadId: "", lastActiveAt: now, lastAddressedAt: now })
      .onConflictDoUpdate({ target: sessions.conversationKey, set: { lastAddressedAt: now } })
      .run();
  }

  /** The agent replied to `user` here: the thread is answered. */
  replied(conversationKey: string, user: string): void {
    this.db
      .update(sessions)
      .set({ lastAddressedAt: this.now(), unanswered: 0, repliedTo: user })
      .where(eq(sessions.conversationKey, conversationKey))
      .run();
  }

  /** Someone wrote in the thread without the agent replying (yet). */
  noteUnanswered(conversationKey: string): void {
    this.db
      .update(sessions)
      .set({ unanswered: sql`${sessions.unanswered} + 1` })
      .where(eq(sessions.conversationKey, conversationKey))
      .run();
  }

  /** Mute (only reply when mentioned) or unmute a conversation. False if it has no session. */
  setMuted(conversationKey: string, muted: boolean): boolean {
    return (
      this.db
        .update(sessions)
        .set({ muted })
        .where(eq(sessions.conversationKey, conversationKey))
        .returning({ key: sessions.conversationKey })
        .all().length > 0
    );
  }

  /** Most recently active sessions first. */
  list(limit = 20): {
    conversationKey: string;
    threadId: string;
    lastActiveAt: number;
    muted: boolean;
    unanswered: number;
  }[] {
    return this.db
      .select({
        conversationKey: sessions.conversationKey,
        threadId: sessions.threadId,
        lastActiveAt: sessions.lastActiveAt,
        muted: sessions.muted,
        unanswered: sessions.unanswered,
      })
      .from(sessions)
      .where(ne(sessions.threadId, "")) // just reset with /new: no Codex session yet
      .orderBy(desc(sessions.lastActiveAt))
      .limit(limit)
      .all();
  }

  count(): number {
    return (
      this.db.select({ n: count() }).from(sessions).where(ne(sessions.threadId, "")).get()?.n ?? 0
    );
  }

  /** Drop one conversation's session; its next message starts a new Codex session. */
  forget(conversationKey: string): boolean {
    return (
      this.db
        .delete(sessions)
        .where(eq(sessions.conversationKey, conversationKey))
        .returning({ key: sessions.conversationKey })
        .all().length > 0
    );
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
