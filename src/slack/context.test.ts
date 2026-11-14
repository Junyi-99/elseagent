import { describe, expect, test } from "bun:test";
import { fetchThreadContext, MAX_CONTEXT_MESSAGES, type RepliesClient } from "./context.ts";

const BOT = "UBOT";

function client(messages: { user?: string; text?: string; ts: string; bot_id?: string }[]) {
  const calls: unknown[] = [];
  const c: RepliesClient = {
    conversations: {
      async replies(args) {
        calls.push(args);
        return { messages };
      },
    },
  };
  return { c, calls };
}

describe("fetchThreadContext", () => {
  const thread = [
    { user: "U1", text: "parent", ts: "1.0" },
    { user: BOT, text: "my earlier reply", ts: "2.0" },
    { user: "U2", text: "between", ts: "3.0" },
    { user: "U1", text: "the mention", ts: "4.0" },
  ];

  test("whole thread before the message, without the agent's own messages", async () => {
    const { c } = client(thread);
    const ctx = await fetchThreadContext(
      c,
      { channel: "C", threadTs: "1.0", beforeTs: "4.0" },
      BOT,
    );
    expect(ctx.messages).toEqual([
      { user: "U1", text: "parent" },
      { user: "U2", text: "between" },
    ]);
  });

  test("only messages after what Codex has seen", async () => {
    const { c, calls } = client(thread);
    const ctx = await fetchThreadContext(
      c,
      { channel: "C", threadTs: "1.0", afterTs: "2.0", beforeTs: "4.0" },
      BOT,
    );
    expect(ctx.messages).toEqual([{ user: "U2", text: "between" }]);
    expect(calls[0]).toMatchObject({ oldest: "2.0", latest: "4.0", inclusive: false });
  });

  test("keeps the most recent messages when there are too many", async () => {
    const many = Array.from({ length: MAX_CONTEXT_MESSAGES + 5 }, (_, i) => ({
      user: "U1",
      text: `m${i}`,
      ts: `${i + 1}.0`,
    }));
    const { c } = client(many);
    const ctx = await fetchThreadContext(
      c,
      { channel: "C", threadTs: "1.0", beforeTs: "999.0" },
      BOT,
    );
    expect(ctx.omitted).toBe(5);
    expect(ctx.messages[0]?.text).toBe("m5");
  });
});
