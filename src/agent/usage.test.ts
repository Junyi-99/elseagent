import { describe, expect, test } from "bun:test";
import type { UsageRecord } from "../state/index.ts";
import { dayIn, startOfDay, summarizeUsage, usagePeriod } from "./usage.ts";

const SH = "Asia/Shanghai";
const NY = "America/New_York";

describe("periods", () => {
  test("days start at midnight in the time zone, also across DST", () => {
    expect(new Date(startOfDay("2026-11-16", SH)).toISOString()).toBe("2026-11-15T16:00:00.000Z");
    expect(new Date(startOfDay("2026-03-08", NY)).toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(new Date(startOfDay("2026-03-09", NY)).toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(dayIn(Date.parse("2026-11-15T17:00:00Z"), SH)).toBe("2026-11-16");
  });

  test("since/until dates are whole days; default is the last 7 days", () => {
    const now = Date.parse("2026-11-15T12:00:00Z");
    expect(usagePeriod({ since: "2026-11-09", until: "2026-11-15" }, SH, now)).toEqual({
      from: Date.parse("2026-11-08T16:00:00Z"),
      to: Date.parse("2026-11-15T16:00:00Z"),
    });
    expect(usagePeriod({}, SH, now)).toEqual({ from: now - 7 * 86_400_000, to: now });
    expect(usagePeriod({ days: 1 }, SH, now).from).toBe(now - 86_400_000);
    expect(usagePeriod({ since: "2026-11-15T00:00:00+08:00" }, SH, now).from).toBe(
      Date.parse("2026-11-14T16:00:00Z"),
    );
    expect(() => usagePeriod({ since: "yesterday" }, SH, now)).toThrow("Invalid date");
    expect(() => usagePeriod({ since: "2026-11-20" }, SH, now)).toThrow("empty");
  });
});

test("summarizeUsage totals and groups", () => {
  const row = (fields: Partial<UsageRecord>): UsageRecord => ({
    at: 0,
    conversationKey: "C1:1",
    channel: "C1",
    user: "U1",
    scheduleId: null,
    threadId: null,
    inputTokens: 100,
    cachedInputTokens: 50,
    outputTokens: 10,
    reasoningOutputTokens: 5,
    durationMs: 2000,
    ...fields,
  });
  const rows = [row({}), row({ user: "U2", outputTokens: 90 }), row({ user: "", scheduleId: 3 })];
  const period = { from: 0, to: 1000 };
  const byUser = summarizeUsage(rows, period, "UTC", "user");
  expect(byUser).toMatchObject({
    turns: 3,
    inputTokens: 300,
    cachedInputTokens: 150,
    outputTokens: 110,
    totalTokens: 410,
    averageTurnSeconds: 2,
    groupBy: "user",
  });
  expect(byUser.groups?.map((g) => [(g as Record<string, unknown>).user, g.totalTokens])).toEqual([
    ["U2", 190],
    ["U1", 110],
    ["schedule #3", 110],
  ]);
  expect(summarizeUsage([], period, "UTC")).not.toHaveProperty("groups");
});
