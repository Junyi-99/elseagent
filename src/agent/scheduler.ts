import type { MessageQueue, NewQueuedMessage, QueuedMessage } from "../state/index.ts";

/** Handles one message (one Codex turn). `shutdown` aborts when the agent is stopping. */
export type TurnRunner = (message: QueuedMessage, shutdown: AbortSignal) => Promise<void>;

export type SubmitResult =
  | { status: "started" }
  | { status: "queued"; position: number }
  | { status: "rejected" };

export interface SchedulerOptions {
  maxConcurrent: number;
  maxQueue: number;
  onError?: (err: unknown, message: QueuedMessage) => void;
}

/**
 * Runs queued messages with at most `maxConcurrent` turns at once, oldest first, one at a time
 * per conversation. The queue itself is persistent (SQLite), so pending messages survive restarts.
 */
export class Scheduler {
  private readonly running = new Map<number, Promise<void>>();
  private readonly shutdown = new AbortController();

  constructor(
    private readonly queue: MessageQueue,
    private readonly run: TurnRunner,
    private readonly options: SchedulerOptions,
  ) {}

  get runningCount(): number {
    return this.running.size;
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
      const task = this.run(message, this.shutdown.signal)
        .catch((err) => this.options.onError?.(err, message))
        .finally(() => {
          this.queue.remove(message.id);
          this.running.delete(message.id);
          this.pump();
        });
      this.running.set(message.id, task);
    }
  }

  /** Stop taking work, abort running turns, and wait for them to wrap up. */
  async stop(): Promise<void> {
    this.shutdown.abort();
    await Promise.allSettled(this.running.values());
  }
}
