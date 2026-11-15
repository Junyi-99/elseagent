import { describe, expect, test } from "bun:test";
import { conversationKey } from "../types.ts";
import type { TgMessage } from "./api.ts";
import {
  chatChannel,
  chatIdOf,
  fromTelegramMessage,
  parseCommand,
  startText,
  statusText,
} from "./message.ts";

const msg = (fields: Partial<TgMessage> = {}): TgMessage => ({
  message_id: 10,
  chat: { id: 42, type: "private" },
  from: { id: 42, is_bot: false, first_name: "Ann" },
  text: "hello",
  ...fields,
});

describe("fromTelegramMessage", () => {
  test("a topic message is its own conversation, keyed by chat and topic", () => {
    const m = fromTelegramMessage(msg({ message_thread_id: 7, is_topic_message: true }));
    expect(m).toEqual({
      channel: "tg:42",
      ts: "10",
      threadTs: "7",
      user: "42",
      text: "hello",
      isDirect: true,
    });
    expect(m && conversationKey(m)).toBe("tg:42:7");
  });

  test("without a topic the chat is one conversation", () => {
    const m = fromTelegramMessage(msg({ message_thread_id: 7 })); // not a topic message
    expect(m?.threadTs).toBeUndefined();
    expect(m && conversationKey(m)).toBe("tg:42");
  });

  test("uses a caption; ignores groups, bots and messages without text", () => {
    expect(fromTelegramMessage(msg({ text: undefined, caption: "look" }))?.text).toBe("look");
    expect(fromTelegramMessage(msg({ chat: { id: -1, type: "group" } }))).toBeNull();
    expect(fromTelegramMessage(msg({ from: { id: 1, is_bot: true, first_name: "b" } }))).toBeNull();
    expect(fromTelegramMessage(msg({ text: undefined }))).toBeNull();
  });
});

test("parseCommand", () => {
  expect(parseCommand("/start")).toEqual({ command: "start", args: "" });
  expect(parseCommand("/New@my_bot  hi there")).toEqual({ command: "new", args: "hi there" });
  expect(parseCommand("not /a command")).toBeNull();
  expect(parseCommand("/path/to/file")).toBeNull();
});

test("channel IDs", () => {
  expect(chatChannel(42)).toBe("tg:42");
  expect(chatIdOf("tg:-100123")).toBe(-100123);
  expect(chatIdOf("C0123")).toBeNull();
  expect(chatIdOf("tg:abc")).toBeNull();
});

test("statusText turns the status line into a sentence", () => {
  expect(statusText("is running `bun test`…")).toBe("Running `bun test`…");
});

test("startText tells the user their ID and whether they're allowed", () => {
  expect(startText("42", false, { topicsEnabled: true })).toContain("telegram.allowedUsers");
  expect(startText("42", true, { topicsEnabled: true })).toContain("Each topic");
  expect(startText("42", true, { topicsEnabled: false })).toContain("`42`");
});
