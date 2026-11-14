import type { MessageQueue, Schedule, ScheduleStore, SessionStore } from "../state/index.ts";
import { checkTimezone, formatTime, ScheduleError } from "./cron.ts";
import type { Scheduler } from "./scheduler.ts";
import type { ScheduleRunner } from "./schedules.ts";

/** Who is calling an admin tool: the turn the Codex call came from. */
export interface Caller {
  user: string;
  channel: string;
  conversationKey: string;
}

export interface AdminDeps {
  scheduler: Pick<Scheduler, "runningTurns" | "cancel">;
  queue: Pick<MessageQueue, "pendingCount" | "listPending" | "removePending">;
  sessions: Pick<SessionStore, "list" | "count" | "forget">;
  schedules: Pick<ScheduleStore, "list" | "get" | "delete" | "count">;
  scheduleRunner: Pick<ScheduleRunner, "create" | "runNow">;
  /** Make sure the bot can post in `ref` (name or ID) and return the channel ID. */
  ensureChannel(ref: string): Promise<string>;
  limits: {
    maxConcurrent: number;
    maxQueue: number;
    turnTimeoutMinutes: number;
    sessionIdleDays: number;
  };
  defaultTimezone: string;
  now?: () => number;
}

/** Errors meant for the caller (shown to Codex as tool errors). */
export class AdminError extends Error {
  override name = "AdminError";
}

const preview = (text: string, max = 120) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

/** The agent's own state and controls, exposed to Codex through the elseagent MCP tools. */
export class Admin {
  private readonly now: () => number;

  constructor(private readonly deps: AdminDeps) {
    this.now = deps.now ?? Date.now;
  }

  status() {
    const { scheduler, queue, sessions, schedules, limits } = this.deps;
    const now = this.now();
    return {
      limits,
      running: scheduler.runningTurns().map(({ message, startedAt }) => ({
        conversation: message.conversationKey,
        user: message.user,
        scheduleId: message.scheduleId,
        text: preview(message.text),
        runningForSeconds: Math.round((now - startedAt) / 1000),
      })),
      queued: queue.pendingCount(),
      sessions: sessions.count(),
      schedules: schedules.count(),
    };
  }

  listQueue(limit = 50) {
    return this.deps.queue.listPending(limit).map((m, i) => ({
      id: m.id,
      position: i + 1,
      conversation: m.conversationKey,
      user: m.user,
      scheduleId: m.scheduleId,
      text: preview(m.text),
    }));
  }

  listSessions(limit = 20) {
    return this.deps.sessions.list(limit).map((s) => ({
      conversation: s.conversationKey,
      codexThreadId: s.threadId,
      lastActive: iso(s.lastActiveAt),
    }));
  }

  cancelTurn(conversation: string, caller: Caller): string {
    if (conversation === caller.conversationKey) {
      throw new AdminError("That is the turn you are running in; it can't cancel itself.");
    }
    if (!this.deps.scheduler.cancel(conversation, caller.user)) {
      throw new AdminError(`Nothing is running in ${conversation}.`);
    }
    return `Stopped the running turn in ${conversation}.`;
  }

  removeQueued(id: number): string {
    const removed = this.deps.queue.removePending(id);
    if (!removed) throw new AdminError(`No queued message with id ${id} (it may have started).`);
    return `Removed queued message ${id} from ${removed.conversationKey}.`;
  }

  forgetSession(conversation: string): string {
    if (!this.deps.sessions.forget(conversation)) {
      throw new AdminError(`No session for ${conversation}.`);
    }
    return `Forgot ${conversation}; its next message starts a new Codex session.`;
  }

  async scheduleCreate(
    input: { name: string; cron: string; prompt: string; channel?: string; timezone?: string },
    caller: Caller,
  ) {
    const timezone = input.timezone ?? this.deps.defaultTimezone;
    try {
      checkTimezone(timezone);
      const channel = input.channel ? await this.deps.ensureChannel(input.channel) : caller.channel;
      return this.describe(
        this.deps.scheduleRunner.create({
          name: input.name,
          cron: input.cron,
          timezone,
          channel,
          prompt: input.prompt,
          createdBy: caller.user,
        }),
      );
    } catch (err) {
      throw new AdminError((err as Error).message);
    }
  }

  scheduleList() {
    return this.deps.schedules.list().map((s) => this.describe(s));
  }

  scheduleDelete(id: number): string {
    const deleted = this.deps.schedules.delete(id);
    if (!deleted) throw new AdminError(`No schedule with id ${id}.`);
    return `Deleted schedule #${id} "${deleted.name}".`;
  }

  scheduleRunNow(id: number): string {
    const schedule = this.deps.schedules.get(id);
    if (!schedule) throw new AdminError(`No schedule with id ${id}.`);
    if (!this.deps.scheduleRunner.runNow(schedule)) throw new AdminError("The queue is full.");
    return `Queued a run of schedule #${id} "${schedule.name}"; its result is posted in <#${schedule.channel}>.`;
  }

  private describe(s: Schedule) {
    return {
      id: s.id,
      name: s.name,
      cron: s.cron,
      timezone: s.timezone,
      channel: s.channel,
      prompt: s.prompt,
      createdBy: s.createdBy,
      nextRun: formatTime(s.nextRunAt, s.timezone),
      lastRun: s.lastRunAt === null ? null : formatTime(s.lastRunAt, s.timezone),
    };
  }
}

export { ScheduleError };
