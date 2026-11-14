import { describe, expect, test } from "bun:test";
import { formatTime, nextRun, ScheduleError } from "./cron.ts";

const at = (iso: string) => Date.parse(iso);

describe("nextRun", () => {
  test("evaluates the expression in the schedule's time zone", () => {
    // 09:00 in Shanghai is 01:00 UTC.
    expect(nextRun("0 9 * * *", "Asia/Shanghai", at("2026-11-14T12:00:00Z"))).toBe(
      at("2026-11-15T01:00:00Z"),
    );
    expect(nextRun("0 9 * * *", "UTC", at("2026-11-14T08:00:00Z"))).toBe(
      at("2026-11-14T09:00:00Z"),
    );
  });

  test("refuses invalid, never-firing and too-frequent expressions, and unknown zones", () => {
    expect(() => nextRun("nope", "UTC")).toThrow(ScheduleError);
    expect(() => nextRun("0 9 30 2 *", "UTC")).toThrow("never runs");
    expect(() => nextRun("* * * * *", "UTC")).toThrow("more often than every 5 minutes");
    expect(() => nextRun("0 9 * * *", "Mars/Base")).toThrow("Unknown time zone");
    expect(() => nextRun("*/5 * * * *", "UTC")).not.toThrow();
  });
});

test("formatTime shows the local time and zone", () => {
  expect(formatTime(at("2026-11-15T01:00:00Z"), "Asia/Shanghai")).toBe(
    "2026-11-15 09:00 (Asia/Shanghai)",
  );
});
