import { describe, expect, test } from "bun:test";
import type { Reply, ThreadContext } from "../slack/index.ts";
import { openStateDb, type QueuedMessage, SessionStore } from "../state/index.ts";
import { REPLY_SCHEMA } from "./reply.ts";
import { createTurnRunner, formatInput, REACTIONS, type TurnDeps } from "./turn.ts";

const DAY = 24 * 60 * 60 * 1000;

const message = (
  conversationKey = "C1:1.0",
  text = "fix the build",
  ts = "2.0",
): QueuedMessage => ({
  id: 1,
  conversationKey,
  channel: "C1",
  ts,
  threadTs: "1.0",
  user: "U1",
  text,
});

const json = (message: string, choices: string[] = []) => JSON.stringify({ message, choices });

/** Fake Codex: records calls; `behave` decides what each run returns. */
function fakeCodex(behave: (input: string, signal: AbortSignal) => Promise<string>) {
  const calls: { kind: "start" | "resume"; id: string; input: string; schema: unknown }[] = [];
  let next = 0;
  const thread = (id: string | null) => {
    let threadId = id;
    return {
      get id() {
        return threadId;
      },
      async run(input: string, opts: { signal: AbortSignal; outputSchema: unknown }) {
        threadId ??= `thread-${++next}`;
        calls.push({
          kind: id ? "resume" : "start",
          id: threadId,
          input,
          schema: opts.outputSchema,
        });
        return { finalResponse: await behave(input, opts.signal), items: [], usage: null };
      },
    };
  };
  const codex = {
    startThread: () => thread(null),
    resumeThread: (id: string) => thread(id),
  } as unknown as TurnDeps["codex"];
  return { codex, calls };
}

function setup(
  behave: Parameters<typeof fakeCodex>[0],
  { turnTimeoutMs = 1_000, context = { messages: [], omitted: 0 } as ThreadContext } = {},
) {
  const { codex, calls } = fakeCodex(behave);
  const posts: { text: string; choices: string[] }[] = [];
  const reactions: string[] = [];
  const contextCalls: (string | null)[] = [];
  const reply: Reply = {
    post: async (text, choices = []) => void posts.push({ text, choices }),
    react: async (n) => void reactions.push(`+${n}`),
    unreact: async (n) => void reactions.push(`-${n}`),
  };
  const sessions = new SessionStore(openStateDb(":memory:"));
  const run = createTurnRunner({
    codex,
    sessions,
    threadOptions: {},
    replyTo: () => reply,
    threadContext: async (_m, afterTs) => {
      contextCalls.push(afterTs);
      return context;
    },
    turnTimeoutMs,
    sessionIdleMs: 7 * DAY,
    logger: { warn: () => {} },
  });
  return { run, calls, sessions, posts, reactions, contextCalls };
}

const never = new AbortController().signal;

describe("turn runner", () => {
  test("starts a Codex thread with the reply schema, posts the answer, remembers the thread", async () => {
    const { run, calls, posts, reactions, sessions } = setup(async () => json("Fixed it."));
    await run(message(), never);
    expect(calls).toEqual([
      { kind: "start", id: "thread-1", input: "<@U1>: fix the build", schema: REPLY_SCHEMA },
    ]);
    expect(posts).toEqual([{ text: "Fixed it.", choices: [] }]);
    expect(reactions).toEqual([
      `-${REACTIONS.queued}`,
      `+${REACTIONS.working}`,
      `-${REACTIONS.working}`,
      `+${REACTIONS.done}`,
    ]);
    expect(sessions.get("C1:1.0", DAY)).toEqual({ threadId: "thread-1", lastSeenTs: "2.0" });
  });

  test("posts choices as buttons", async () => {
    const { run, posts } = setup(async () => json("Which branch?", ["main", "release"]));
    await run(message(), never);
    expect(posts).toEqual([{ text: "Which branch?", choices: ["main", "release"] }]);
  });

  test("continues the same Codex thread and only fetches context it hasn't seen", async () => {
    const { run, calls, contextCalls } = setup(async () => json("ok"));
    await run(message("C1:1.0", "first", "2.0"), never);
    await run(message("C1:1.0", "second", "7.0"), never);
    expect(calls.map((c) => [c.kind, c.id])).toEqual([
      ["start", "thread-1"],
      ["resume", "thread-1"],
    ]);
    expect(contextCalls).toEqual([null, "2.0"]);
  });

  test("includes unseen thread messages before the message for the agent", async () => {
    const context = { messages: [{ user: "U2", text: "it fails on CI too" }], omitted: 0 };
    const { run, calls } = setup(async () => json("ok"), { context });
    await run(message(), never);
    expect(calls[0]?.input).toBe(
      "Messages in this thread since your last reply:\n<@U2>: it fails on CI too\n\n" +
        "Message for you:\n<@U1>: fix the build",
    );
  });

  test("other conversations get their own thread", async () => {
    const { run, calls } = setup(async () => json("ok"));
    await run(message("C1:1.0"), never);
    await run(message("C1:9.0"), never);
    expect(calls.map((c) => c.id)).toEqual(["thread-1", "thread-2"]);
  });

  const waitForAbort = (_: string, signal: AbortSignal) =>
    new Promise<string>((_resolve, reject) => {
      if (signal.aborted) reject(new Error("aborted"));
      signal.addEventListener("abort", () => reject(new Error("aborted")));
    });

  test("stops a turn that runs past the timeout and keeps the session", async () => {
    const { run, posts, reactions, sessions } = setup(waitForAbort, { turnTimeoutMs: 20 });
    await run(message(), never);
    expect(posts[0]?.text).toContain("took longer than");
    expect(reactions.at(-1)).toBe(`+${REACTIONS.failed}`);
    expect(sessions.get("C1:1.0", DAY)?.threadId).toBe("thread-1");
  });

  test("on shutdown, tells the thread to resend", async () => {
    const { run, posts } = setup(waitForAbort);
    const shutdown = new AbortController();
    const turn = run(message(), shutdown.signal);
    shutdown.abort();
    await turn;
    expect(posts[0]?.text).toContain("restarted");
  });

  test("reports Codex errors in the thread", async () => {
    const { run, posts, reactions } = setup(async () => {
      throw new Error("model overloaded");
    });
    await run(message(), never);
    expect(posts).toEqual([{ text: "Codex failed: model overloaded", choices: [] }]);
    expect(reactions.at(-1)).toBe(`+${REACTIONS.failed}`);
  });
});

describe("formatInput", () => {
  test("is just the message when there is no new context", () => {
    expect(formatInput({ user: "U9", text: "hi" }, { messages: [], omitted: 0 })).toBe("<@U9>: hi");
  });

  test("notes omitted messages", () => {
    const input = formatInput(
      { user: "U9", text: "hi" },
      { messages: [{ user: "U1", text: "a" }], omitted: 3 },
    );
    expect(input).toContain("(3 earlier messages omitted)\n<@U1>: a");
  });
});
