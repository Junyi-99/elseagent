import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Only routing state lives here. Conversation history is kept by Codex itself.

/** Maps a Slack conversation (thread, or top-level DM) to the Codex thread holding its context. */
export const sessions = sqliteTable(
  "sessions",
  {
    conversationKey: text("conversation_key").primaryKey(),
    threadId: text("thread_id").notNull(),
    /** Unix epoch milliseconds. */
    lastActiveAt: integer("last_active_at").notNull(),
    /** Slack ts of the last message Codex has seen; thread context starts after it. */
    lastSeenTs: text("last_seen_ts"),
  },
  (t) => [index("sessions_last_active").on(t.lastActiveAt)],
);

/**
 * Buffer of Slack messages not yet answered: waiting for a slot, or being handled right now.
 * A row is deleted as soon as its turn ends, so this never grows into a message history.
 */
export const queue = sqliteTable(
  "queue",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversationKey: text("conversation_key").notNull(),
    channel: text("channel").notNull(),
    ts: text("ts").notNull(),
    threadTs: text("thread_ts"),
    user: text("user").notNull(),
    text: text("text").notNull(),
    status: text("status", { enum: ["pending", "running"] })
      .notNull()
      .default("pending"),
    /** Set for a scheduled run: there is no Slack message, the result is posted top-level. */
    scheduleId: integer("schedule_id"),
  },
  (t) => [
    index("queue_status").on(t.status, t.id),
    index("queue_conversation").on(t.conversationKey, t.status),
  ],
);

/** Recurring tasks created by users through the agent ("check X every morning, post in #ops"). */
export const schedules = sqliteTable(
  "schedules",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    /** Cron expression (5 or 6 fields), evaluated in `timezone`. */
    cron: text("cron").notNull(),
    /** IANA time zone, e.g. Asia/Shanghai. */
    timezone: text("timezone").notNull(),
    /** Slack channel ID the results are posted to. */
    channel: text("channel").notNull(),
    /** What Codex is asked to do on each run. */
    prompt: text("prompt").notNull(),
    createdBy: text("created_by").notNull(),
    /** Unix epoch milliseconds. */
    createdAt: integer("created_at").notNull(),
    nextRunAt: integer("next_run_at").notNull(),
    lastRunAt: integer("last_run_at"),
  },
  (t) => [index("schedules_next_run").on(t.nextRunAt)],
);
