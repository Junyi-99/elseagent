import type { MessageQueue, NewQueuedMessage, QueuedMessage } from "../state/index.ts";

/** Why a running turn was stopped; carried as the abort signal's `reason`. */
export type StopReason = { kind: "shutdown" } | { kind: "cancelled"; by: string };

export function stopReason(signal: AbortSignal): StopReason | null {
  if (!signal.aborted) return null;
  const reason = signal.reason as Partial<StopReason> | undefined;
  return reason?.kind === "cancelled" ? (reason as StopReason) : { kind: "shutdown" };
}

/** Handles one message (one Codex turn). `signal` aborts on shutdown or cancellation. */
export type TurnRunner = (message: QueuedMessage, signal: AbortSignal) => Promise<void>;

export type SubmitResult =
  | { status: "started" }
  | { status: "queued"; position: number }
  | { status: "rejected" };

export interface SchedulerOptions {
  maxConcurrent: number;
  maxQueue: number;
  onError?: (err: unknown, message: QueuedMessage) => void;
  now?: () => number;
}

export interface RunningTurn {
  message: QueuedMessage;
  /** Unix epoch milliseconds. */
  startedAt: number;
}

interface Running extends RunningTurn {
  controller: AbortController;
  task: Promise<void>;
}

/**
 * Runs queued messages with at most `maxConcurrent` turns at once, oldest first, one at a time
 * per conversation. The queue itself is persistent (SQLite), so pending messages survive restarts.
 */
export class Scheduler {
  private readonly running = new Map<number, Running>();
  private readonly shutdown = new AbortController();
  private readonly now: () => number;

  constructor(
    private readonly queue: MessageQueue,
    private readonly run: TurnRunner,
    private readonly options: SchedulerOptions,
  ) {
    this.now = options.now ?? Date.now;
  }

  get runningCount(): number {
    return this.running.size;
  }

  /** Turns in progress, oldest first. */
  runningTurns(): RunningTurn[] {
    return [...this.running.values()].map(({ message, startedAt }) => ({ message, startedAt }));
  }

  /** Queue a message and start it right away if a slot (and its conversation) is free. */
  submit(message: NewQueuedMessage): SubmitResult {
    if (this.shutdown.signal.aborted) return { status: "rejected" };
    if (this.queue.pendingCount() >= this.options.maxQueue) return { status: "rejected" };
    const { id } = this.queue.push(message);
    this.pump();
    return this.running.has(id)
      ? { status: "started" }
      : { status: "queued", position: this.queue.position(id) };
  }

  /** Start as many eligible messages as there are free slots. */
  pump(): void {
    while (!this.shutdown.signal.aborted && this.running.size < this.options.maxConcurrent) {
      const message = this.queue.claimNext();
      if (!message) return;
      const controller = new AbortController();
      const signal = AbortSignal.any([this.shutdown.signal, controller.signal]);
      const task = this.run(message, signal)
        .catch((err) => this.options.onError?.(err, message))
        .finally(() => {
          this.queue.remove(message.id);
          this.running.delete(message.id);
          this.pump();
        });
      this.running.set(message.id, { message, startedAt: this.now(), controller, task });
    }
  }

  /** Stop the running turn of a conversation. Returns false if nothing is running there. */
  cancel(conversationKey: string, by: string): boolean {
    for (const turn of this.running.values()) {
      if (turn.message.conversationKey === conversationKey) {
        turn.controller.abort({ kind: "cancelled", by } satisfies StopReason);
        return true;
      }
    }
    return false;
  }

  /** Stop taking work, abort running turns, and wait for them to wrap up. */
  async stop(): Promise<void> {
    this.shutdown.abort({ kind: "shutdown" } satisfies StopReason);
    await Promise.allSettled([...this.running.values()].map((t) => t.task));
  }
}
