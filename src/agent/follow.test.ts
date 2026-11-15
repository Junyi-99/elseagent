import { describe, expect, test } from "bun:test";
import type { FollowState } from "../state/index.ts";
import {
  FOLLOW_IDLE_MS,
  FOLLOW_MAX_UNANSWERED,
  followCommand,
  isFollowing,
  routeThreadMessage,
} from "./follow.ts";

const NOW = 1_000_000_000_000;
const state = (fields: Partial<FollowState> = {}): FollowState => ({
  muted: false,
  lastAddressedAt: NOW - 1000,
  lastActiveAt: NOW - 1000,
  unanswered: 3,
  repliedTo: "U1",
  ...fields,
});
const msg = (user = "U2", mentionsOthers = false) => ({ user, mentionsOthers });

describe("isFollowing", () => {
  test("a thread with a session is followed until muted, busy or idle", () => {
    expect(isFollowing(state(), NOW)).toBe(true);
    expect(isFollowing(null, NOW)).toBe(false);
    expect(isFollowing(state({ muted: true }), NOW)).toBe(false);
    expect(isFollowing(state({ unanswered: FOLLOW_MAX_UNANSWERED }), NOW)).toBe(false);
    expect(isFollowing(state({ lastAddressedAt: NOW - FOLLOW_IDLE_MS }), NOW)).toBe(false);
  });

  test("never addressed (a scheduled result): idle time counts from the last turn", () => {
    expect(isFollowing(state({ lastAddressedAt: null }), NOW)).toBe(true);
    expect(isFollowing(state({ lastAddressedAt: null, lastActiveAt: 0 }), NOW)).toBe(false);
  });
});

describe("routeThreadMessage", () => {
  test("not followed: ignored (stays context)", () => {
    expect(routeThreadMessage(null, msg(), NOW)).toEqual({ kind: "ignore" });
    expect(routeThreadMessage(state({ muted: true }), msg(), NOW)).toEqual({ kind: "ignore" });
  });

  test("a message mentioning someone else is for them", () => {
    expect(routeThreadMessage(state(), msg("U2", true), NOW)).toEqual({ kind: "ignore" });
  });

  test("the person the agent just answered: a follow-up", () => {
    const answered = state({ unanswered: 0, repliedTo: "U1" });
    expect(routeThreadMessage(answered, msg("U1"), NOW)).toEqual({ kind: "followup" });
    // Someone else, or after others wrote: the agent decides.
    expect(routeThreadMessage(answered, msg("U2"), NOW)).toEqual({ kind: "passive" });
    expect(routeThreadMessage(state({ unanswered: 1 }), msg("U1"), NOW)).toEqual({
      kind: "passive",
    });
  });
});

test("followCommand", () => {
  expect(followCommand(" !mute ")).toBe("mute");
  expect(followCommand("!UNMUTE")).toBe("unmute");
  expect(followCommand("please !mute")).toBeNull();
});
