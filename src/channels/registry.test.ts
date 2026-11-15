import { expect, test } from "bun:test";
import { Channels } from "./registry.ts";
import type { Channel, Reply } from "./types.ts";

const fake = (platform: Channel["platform"], prefix: string): Channel => ({
  platform,
  label: platform,
  instructions: "",
  owns: (channel) => channel.startsWith(prefix),
  replyTo: () => ({ platform }) as unknown as Reply,
  threadContext: async () => ({ messages: [{ user: platform, text: "" }], omitted: 0 }),
  ensureChannel: async (ref) => `${platform}:${ref}`,
  start: async () => {},
  stop: async () => {},
});

test("each call goes to the channel that owns the chat ID", async () => {
  const channels = new Channels([fake("telegram", "tg:"), fake("slack", "C")]);
  expect(channels.for("tg:1").platform).toBe("telegram");
  expect(channels.for("C1").platform).toBe("slack");
  expect(channels.replyTo({ channel: "C1", ts: "1" })).toEqual({ platform: "slack" } as never);
  const context = await channels.threadContext({ channel: "tg:1", ts: "1", threadTs: null }, null);
  expect(context.messages[0]?.user).toBe("telegram");
  expect(await channels.ensureChannel("tg:5")).toBe("telegram:tg:5");
});

test("a chat ID no channel owns is an error", () => {
  const channels = new Channels([fake("telegram", "tg:")]);
  expect(() => channels.for("C1")).toThrow("telegram");
  expect(() => new Channels([])).toThrow();
});
