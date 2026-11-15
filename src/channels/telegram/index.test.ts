import { describe, expect, test } from "bun:test";
import { ConfigError } from "../../config/index.ts";
import type { IncomingMessage } from "../types.ts";
import { TelegramError, type TgUpdate } from "./api.ts";
import { createTelegramBot } from "./index.ts";

const silent = { info: () => {}, warn: () => {} };

/** A fake Bot API: records calls, answers getUpdates from a queue (then waits for abort). */
function fakeApi({
  topics = true,
  fail = {} as Record<string, Error>,
}: {
  topics?: boolean;
  fail?: Record<string, Error>;
} = {}) {
  const calls: { method: string; params: Record<string, unknown> }[] = [];
  const updates: TgUpdate[][] = [];
  let nextId = 100;
  let delivered: () => void = () => {};
  const drained = () =>
    new Promise<void>((resolve) => {
      delivered = resolve;
    });
  const api = {
    async call<T>(method: string, params: object = {}, signal?: AbortSignal): Promise<T> {
      const p = params as Record<string, unknown>;
      if (method === "getUpdates") {
        const batch = updates.shift();
        if (batch) return batch as T;
        delivered();
        await new Promise((_, reject) =>
          signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        );
      }
      calls.push({ method, params: p });
      const err = fail[method];
      if (err) throw err;
      switch (method) {
        case "getMe":
          return {
            id: 1,
            is_bot: true,
            first_name: "Bot",
            username: "bot",
            has_topics_enabled: topics,
          } as T;
        case "sendMessage":
          return { message_id: nextId++, chat: { id: p.chat_id, type: "private" } } as T;
        case "createForumTopic":
          return { message_thread_id: 77, name: p.name } as T;
        default:
          return true as T;
      }
    },
  };
  const sent = (method: string) => calls.filter((c) => c.method === method).map((c) => c.params);
  return { api, calls, updates, drained, sent };
}

const userMessage = (text: string, fields: Record<string, unknown> = {}): TgUpdate => ({
  update_id: 1,
  message: {
    message_id: 5,
    message_thread_id: 3,
    is_topic_message: true,
    chat: { id: 42, type: "private" },
    from: { id: 42, is_bot: false, first_name: "Ann" },
    text,
    ...fields,
  },
});

async function run(updates: TgUpdate[], options: Parameters<typeof fakeApi>[0] = {}) {
  const fake = fakeApi(options);
  fake.updates.push(updates);
  const bot = await createTelegramBot(
    { botToken: "t", allowedUsers: ["42"] },
    { api: fake.api, logger: silent },
  );
  const received: IncomingMessage[] = [];
  const drained = fake.drained();
  await bot.start(async (m) => {
    received.push(m);
  });
  await drained;
  await bot.stop();
  return { ...fake, bot, received };
}

describe("createTelegramBot", () => {
  test("a rejected token is a config error", async () => {
    const fake = fakeApi({ fail: { getMe: new TelegramError("getMe", 401, "Unauthorized") } });
    expect(
      createTelegramBot({ botToken: "t", allowedUsers: [] }, { api: fake.api }),
    ).rejects.toBeInstanceOf(ConfigError);
  });

  test("delivers allowed users' messages with their topic", async () => {
    const { received, sent } = await run([userMessage("fix it")]);
    expect(received).toEqual([
      { channel: "tg:42", ts: "5", threadTs: "3", user: "42", text: "fix it", isDirect: true },
    ]);
    expect(sent("setMyCommands")[0]?.commands).toHaveLength(2);
  });

  test("/start answers with the user's ID, allowed or not", async () => {
    const stranger = userMessage("/start", {
      from: { id: 9, is_bot: false, first_name: "X" },
      chat: { id: 9, type: "private" },
    });
    const { received, sent } = await run([userMessage("/start"), stranger]);
    expect(received).toEqual([]);
    const texts = sent("sendMessage").map((p) => p.text as string);
    expect(texts[0]).toContain("<code>42</code>");
    expect(texts[0]).toContain("all set");
    expect(texts[1]).toContain("<code>9</code>");
    expect(texts[1]).toContain("allow list");
    expect(sent("sendMessage")[0]?.message_thread_id).toBe(3);
  });

  test("other users are refused and never reach the agent", async () => {
    const { received, sent } = await run([
      userMessage("hi", {
        from: { id: 9, is_bot: false, first_name: "X" },
        chat: { id: 9, type: "private" },
      }),
    ]);
    expect(received).toEqual([]);
    expect(sent("sendMessage")[0]?.text).toContain("not on this agent's allow list");
  });

  test("/new becomes the new-session command for the topic", async () => {
    const { received } = await run([userMessage("/new")]);
    expect(received).toEqual([
      { channel: "tg:42", ts: "", threadTs: "3", user: "42", text: "/new", isDirect: true },
    ]);
  });

  test("a choice button: marks the pick and sends it as the user's message", async () => {
    const { received, sent } = await run([
      {
        update_id: 2,
        callback_query: {
          id: "q",
          from: { id: 42, is_bot: false, first_name: "Ann" },
          data: "choice:1",
          message: {
            message_id: 8,
            message_thread_id: 3,
            is_topic_message: true,
            chat: { id: 42, type: "private" },
            reply_markup: {
              inline_keyboard: [
                [{ text: "Yes", callback_data: "choice:0" }],
                [{ text: "No", callback_data: "choice:1" }],
              ],
            },
          },
        },
      },
    ]);
    expect(sent("answerCallbackQuery")).toHaveLength(1);
    expect(sent("editMessageReplyMarkup")[0]?.reply_markup).toEqual({
      inline_keyboard: [[{ text: "✓ No", callback_data: "picked" }]],
    });
    expect(received).toEqual([
      { channel: "tg:42", ts: "8", threadTs: "3", user: "42", text: "No", isDirect: true },
    ]);
  });
});

describe("replies", () => {
  const setup = async (options: Parameters<typeof fakeApi>[0] = {}) => {
    const fake = fakeApi(options);
    const bot = await createTelegramBot(
      { botToken: "t", allowedUsers: ["42"] },
      { api: fake.api, logger: silent },
    );
    return { ...fake, bot };
  };

  test("posts HTML in the topic, with choices as buttons on the last part", async () => {
    const { bot, sent } = await setup();
    const reply = bot.replyTo({ channel: "tg:42", ts: "5", threadTs: "3" });
    const id = await reply.post("**Done**", ["Ship", "Wait"]);
    expect(id).toBe("100");
    expect(sent("sendMessage")[0]).toMatchObject({
      chat_id: 42,
      message_thread_id: 3,
      text: "<b>Done</b>",
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "Ship", callback_data: "choice:0" }],
          [{ text: "Wait", callback_data: "choice:1" }],
        ],
      },
    });
  });

  test("falls back to plain text when Telegram can't parse the HTML", async () => {
    const { bot, sent, api } = await setup();
    let first = true;
    const call = api.call.bind(api);
    api.call = async <T>(method: string, params: object = {}, signal?: AbortSignal) => {
      if (method === "sendMessage" && first) {
        first = false;
        throw new TelegramError(method, 400, "Bad Request: can't parse entities");
      }
      return call<T>(method, params, signal);
    };
    await bot.replyTo({ channel: "tg:42", ts: "5" }).post("**x**");
    expect(sent("sendMessage").at(-1)).toMatchObject({ text: "**x**" });
    expect(sent("sendMessage").at(-1)?.parse_mode).toBeUndefined();
  });

  test("a scheduled result opens a new topic and returns it", async () => {
    const { bot, sent } = await setup();
    const reply = bot.replyTo({ channel: "tg:42", ts: "", threadTs: null, startsThread: true });
    expect(await reply.post("CI is green\n\nDetails…")).toBe("77");
    expect(sent("createForumTopic")[0]).toEqual({ chat_id: 42, name: "CI is green" });
    expect(sent("sendMessage")[0]?.message_thread_id).toBe(77);
  });

  test("without threaded mode a scheduled result is posted in the chat", async () => {
    const { bot, sent } = await setup({ topics: false });
    const reply = bot.replyTo({ channel: "tg:42", ts: "", startsThread: true });
    expect(await reply.post("CI is green")).toBeUndefined();
    expect(sent("createForumTopic")).toEqual([]);
    expect(sent("sendMessage")[0]?.message_thread_id).toBeUndefined();
  });

  test("reactions map to Telegram's emoji; unreact clears", async () => {
    const { bot, sent } = await setup();
    const reply = bot.replyTo({ channel: "tg:42", ts: "5" });
    await reply.react("eyes");
    await reply.unreact("eyes");
    expect(sent("setMessageReaction").map((p) => p.reaction)).toEqual([
      [{ type: "emoji", emoji: "👀" }],
      [],
    ]);
  });

  test("status shows as a draft; falls back to typing when drafts are refused", async () => {
    const { bot, sent } = await setup();
    const reply = bot.replyTo({ channel: "tg:42", ts: "5", threadTs: "3" });
    await reply.setStatus("is running `bun test`…");
    await reply.setStatus("");
    expect(sent("sendMessageDraft")[0]).toMatchObject({
      chat_id: 42,
      message_thread_id: 3,
      text: "<i>Running <code>bun test</code>…</i>",
    });

    const refused = await setup({
      fail: { sendMessageDraft: new TelegramError("sendMessageDraft", 400, "Bad Request") },
    });
    const r = refused.bot.replyTo({ channel: "tg:42", ts: "5" });
    await r.setStatus("is thinking…");
    await r.setStatus("");
    expect(refused.sent("sendChatAction")[0]).toMatchObject({ action: "typing" });
  });

  test("ensureChannel accepts only allowed users' chats", async () => {
    const { bot } = await setup();
    expect(await bot.ensureChannel("tg:42")).toBe("tg:42");
    expect(bot.ensureChannel("tg:9")).rejects.toThrow("allowedUsers");
    expect(bot.ensureChannel("#ops")).rejects.toThrow("tg:<chat id>");
    expect(bot.owns("tg:42")).toBe(true);
    expect(bot.owns("C0123")).toBe(false);
  });
});
