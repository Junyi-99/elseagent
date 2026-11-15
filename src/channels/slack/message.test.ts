import { describe, expect, test } from "bun:test";
import {
  conversationKey,
  fromDirectMessage,
  fromMention,
  slashCommandMessage,
  stripMention,
} from "./message.ts";

const BOT = "UBOT";

type MentionEvent = Parameters<typeof fromMention>[0];
type MessageEvent = Parameters<typeof fromDirectMessage>[0];

const mention = (fields: Partial<MentionEvent>): MentionEvent =>
  ({
    type: "app_mention",
    channel: "C1",
    ts: "100.1",
    event_ts: "100.1",
    user: "U1",
    text: `<@${BOT}> hello`,
    ...fields,
  }) as MentionEvent;

const dm = (fields: Record<string, unknown>): MessageEvent =>
  ({
    type: "message",
    subtype: undefined,
    channel: "D1",
    channel_type: "im",
    ts: "200.1",
    event_ts: "200.1",
    user: "U1",
    text: "hi",
    ...fields,
  }) as MessageEvent;

describe("stripMention", () => {
  test("removes the bot mention and collapses whitespace", () => {
    expect(stripMention(`<@${BOT}>  fix   the build <@${BOT}>`, BOT)).toBe("fix the build");
  });

  test("keeps mentions of other users", () => {
    expect(stripMention(`<@${BOT}> ask <@U2>`, BOT)).toBe("ask <@U2>");
  });
});

describe("fromMention", () => {
  test("starts a thread on a top-level mention", () => {
    expect(fromMention(mention({}), BOT)).toEqual({
      channel: "C1",
      ts: "100.1",
      threadTs: "100.1",
      user: "U1",
      text: "hello",
      isDirect: false,
    });
  });

  test("replies in the existing thread", () => {
    expect(fromMention(mention({ thread_ts: "99.0" }), BOT)?.threadTs).toBe("99.0");
  });

  test("ignores bots and itself", () => {
    expect(fromMention(mention({ bot_id: "B1" }), BOT)).toBeNull();
    expect(fromMention(mention({ user: BOT }), BOT)).toBeNull();
    expect(fromMention(mention({ user: undefined }), BOT)).toBeNull();
  });
});

describe("fromDirectMessage", () => {
  test("handles a top-level DM without a thread", () => {
    expect(fromDirectMessage(dm({}), BOT)).toEqual({
      channel: "D1",
      ts: "200.1",
      threadTs: undefined,
      user: "U1",
      text: "hi",
      isDirect: true,
    });
  });

  test("keeps the thread for DM thread replies", () => {
    expect(fromDirectMessage(dm({ thread_ts: "150.0" }), BOT)?.threadTs).toBe("150.0");
  });

  test("ignores channel messages (handled via app_mention)", () => {
    expect(fromDirectMessage(dm({ channel_type: "channel" }), BOT)).toBeNull();
  });

  test("ignores edits, bots and its own messages", () => {
    expect(fromDirectMessage(dm({ subtype: "message_changed" }), BOT)).toBeNull();
    expect(fromDirectMessage(dm({ bot_id: "B1" }), BOT)).toBeNull();
    expect(fromDirectMessage(dm({ user: BOT }), BOT)).toBeNull();
  });
});

test("a DM slash command becomes a message with no ts, at the DM's top level", () => {
  const m = slashCommandMessage("D1", "U1", "/new");
  expect(m).toEqual({
    channel: "D1",
    ts: "",
    threadTs: undefined,
    user: "U1",
    text: "/new",
    isDirect: true,
  });
  expect(conversationKey(m)).toBe("D1");
});

describe("conversationKey", () => {
  test("a thread is its own conversation; a DM's top level is one conversation", () => {
    expect(conversationKey({ channel: "C1", threadTs: "1.0" })).toBe("C1:1.0");
    expect(conversationKey({ channel: "D1", threadTs: undefined })).toBe("D1");
  });
});
