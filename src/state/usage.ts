import { and, asc, gte, lt } from "drizzle-orm";
import type { StateDb } from "./db.ts";
import { usage } from "./schema.ts";

/** One completed turn's token usage. */
export interface UsageRecord {
  at: number;
  conversationKey: string;
  channel: string;
  /** Empty for a scheduled run. */
  user: string;
  scheduleId: number | null;
  threadId: string | null;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  durationMs: number;
}

/** Token usage per turn, kept for reports. */
export class UsageStore {
  constructor(private readonly db: StateDb) {}

  record(row: UsageRecord): void {
    this.db.insert(usage).values(row).run();
  }

  /** Turns that ended in [from, to), oldest first. */
  between(from: number, to: number): UsageRecord[] {
    return this.db
      .select({
        at: usage.at,
        conversationKey: usage.conversationKey,
        channel: usage.channel,
        user: usage.user,
        scheduleId: usage.scheduleId,
        threadId: usage.threadId,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens,
        reasoningOutputTokens: usage.reasoningOutputTokens,
        durationMs: usage.durationMs,
      })
      .from(usage)
      .where(and(gte(usage.at, from), lt(usage.at, to)))
      .orderBy(asc(usage.at))
      .all();
  }
}
