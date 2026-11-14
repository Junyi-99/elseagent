import { describe, expect, test } from "bun:test";
import type { NewQueuedMessage } from "../state/index.ts";
import { openStateDb, ScheduleStore } from "../state/index.ts";
import { MAX_SCHEDULES, ScheduleRunner } from "./schedules.ts";

const at = (iso: string) => Date.parse(iso);

function setup(start: string) {
  let now = at(start);
  const store = new ScheduleStore(openStateDb(":memory:"), () => now);
  const submitted: NewQueuedMessage[] = [];
  let full = false;
  const runner = new ScheduleRunner(
    store,
    {
      submit: (m) => {
        if (full) return { status: "rejected" };
        submitted.push(m);
        return { status: "started" };
      },
    },
    () => now,
  );
  const input = {
    name: "Daily CI",
    cron: "0 9 * * *",
    timezone: "UTC",
    channel: "C_OPS",
    prompt: "Check CI and summarize failures.",
    createdBy: "U1",
  };
  return {
    store,
    runner,
    submitted,
    input,
    setNow: (iso: string) => {
      now = at(iso);
    },
    setFull: (v: boolean) => {
      full = v;
    },
  };
}

describe("ScheduleRunner", () => {
  test("queues a run when due, as a scheduled message, and moves to the next time", () => {
    const { runner, store, submitted, input, setNow } = setup("2026-11-14T08:00:00Z");
    const s = runner.create(input);
    expect(s.nextRunAt).toBe(at("2026-11-14T09:00:00Z"));

    expect(runner.tick()).toBe(0);
    setNow("2026-11-14T09:00:10Z");
    expect(runner.tick()).toBe(1);
    expect(submitted[0]).toMatchObject({
      channel: "C_OPS",
      ts: "",
      threadTs: null,
      user: "U1",
      scheduleId: s.id,
    });
    expect(submitted[0]?.text).toContain("Check CI and summarize failures.");
    expect(store.get(s.id)?.nextRunAt).toBe(at("2026-11-15T09:00:00Z"));
    expect(runner.tick()).toBe(0); // not due again until tomorrow
  });

  test("after downtime, a schedule that missed several runs runs once", () => {
    const { runner, store, submitted, input, setNow } = setup("2026-11-14T08:00:00Z");
    const s = runner.create(input);
    setNow("2026-11-17T12:00:00Z"); // missed 3 runs
    expect(runner.tick()).toBe(1);
    expect(submitted).toHaveLength(1);
    expect(store.get(s.id)?.nextRunAt).toBe(at("2026-11-18T09:00:00Z"));
  });

  test("each run is its own conversation", () => {
    const { runner, store, submitted, input, setNow } = setup("2026-11-14T08:00:00Z");
    const s = runner.create(input);
    runner.runNow(s);
    setNow("2026-11-14T08:00:01Z");
    runner.runNow(store.get(s.id) ?? s);
    expect(new Set(submitted.map((m) => m.conversationKey)).size).toBe(2);
  });

  test("a full queue skips the run but still advances the schedule", () => {
    const { runner, store, input, setNow, setFull } = setup("2026-11-14T08:00:00Z");
    const s = runner.create(input);
    setNow("2026-11-14T09:00:10Z");
    setFull(true);
    const errors: string[] = [];
    expect(runner.tick((_, e) => errors.push((e as Error).message))).toBe(0);
    expect(errors[0]).toContain("queue is full");
    expect(store.get(s.id)?.nextRunAt).toBe(at("2026-11-15T09:00:00Z"));
  });

  test("limits the number of schedules", () => {
    const { runner, input } = setup("2026-11-14T08:00:00Z");
    for (let i = 0; i < MAX_SCHEDULES; i++) runner.create(input);
    expect(() => runner.create(input)).toThrow("already has");
  });
});
