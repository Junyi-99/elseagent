import { describe, expect, test } from "bun:test";
import type { Reply } from "../slack/index.ts";
import { openStateDb, type QueuedMessage, SessionStore } from "../state/index.ts";
import { createTurnRunner, formatInput, REACTIONS, type TurnDeps } from "./turn.ts";

const DAY = 24 * 60 * 60 * 1000;

const message = (conversationKey = "C1:1.0", text = "fix the build"): QueuedMessage => ({
  id: 1,
  conversationKey,
  channel: "C1",
  ts: "2.0",
  threadTs: "1.0",
  user: "U1",
  text,
});

/** Fake Codex: records calls; `behave` decides what each run does. */
function fakeCodex(behave: (input: string, signal: AbortSignal) => Promise<string>) {
  const calls: { kind: "start" | "resume"; id?: string; input?: string }[] = [];
  let next = 0;
  const thread = (id: string | null) => {
    let threadId = id;
    return {
      get id() {
        return threadId;
      },
      async run(input: string, opts: { signal: AbortSignal }) {
        threadId ??= `thread-${++next}`;
        calls.push({ kind: id ? "resume" : "start", id: threadId, input });
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

function fakeSlack() {
  const posts: string[] = [];
  const reactions: string[] = [];
  const reply: Reply = {
    post: async (t) => void posts.push(t),
    react: async (n) => void reactions.push(`+${n}`),
    unreact: async (n) => void reactions.push(`-${n}`),
  };
  return { replyTo: () => reply, posts, reactions };
}

function setup(behave: Parameters<typeof fakeCodex>[0], turnTimeoutMs = 1_000) {
  const { codex, calls } = fakeCodex(behave);
  const slack = fakeSlack();
  const sessions = new SessionStore(openStateDb(":memory:"));
  const run = createTurnRunner({
    codex,
    sessions,
    threadOptions: {},
    replyTo: slack.replyTo,
    turnTimeoutMs,
    sessionIdleMs: 7 * DAY,
    logger: { warn: () => {} },
  });
  return { run, calls, sessions, ...slack };
}

const never = new AbortController().signal;

describe("turn runner", () => {
  test("starts a Codex thread, posts the answer, and remembers the thread", async () => {
    const { run, calls, posts, reactions, sessions } = setup(async () => "Done: fixed it.");
    await run(message(), never);
    expect(calls).toEqual([{ kind: "start", id: "thread-1", input: "<@U1>: fix the build" }]);
    expect(posts).toEqual(["Done: fixed it."]);
    expect(reactions).toEqual([
      `-${REACTIONS.queued}`,
      `+${REACTIONS.working}`,
      `-${REACTIONS.working}`,
      `+${REACTIONS.done}`,
    ]);
    expect(sessions.threadFor("C1:1.0", DAY)).toBe("thread-1");
  });

  test("continues the same Codex thread for follow-ups in the conversation", async () => {
    const { run, calls } = setup(async () => "ok");
    await run(message(), never);
    await run(message("C1:1.0", "and the tests"), never);
    expect(calls.map((c) => [c.kind, c.id])).toEqual([
      ["start", "thread-1"],
      ["resume", "thread-1"],
    ]);
  });

  test("other conversations get their own thread", async () => {
    const { run, calls } = setup(async () => "ok");
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
    const { run, posts, reactions, sessions } = setup(waitForAbort, 20);
    await run(message(), never);
    expect(posts[0]).toContain("took longer than");
    expect(reactions.at(-1)).toBe(`+${REACTIONS.failed}`);
    expect(sessions.threadFor("C1:1.0", DAY)).toBe("thread-1");
  });

  test("on shutdown, tells the thread to resend", async () => {
    const { run, posts } = setup(waitForAbort);
    const shutdown = new AbortController();
    const turn = run(message(), shutdown.signal);
    shutdown.abort();
    await turn;
    expect(posts[0]).toContain("restarted");
  });

  test("reports Codex errors in the thread", async () => {
    const { run, posts, reactions } = setup(async () => {
      throw new Error("model overloaded");
    });
    await run(message(), never);
    expect(posts).toEqual(["Codex failed: model overloaded"]);
    expect(reactions.at(-1)).toBe(`+${REACTIONS.failed}`);
  });

  test("formatInput tells Codex who is speaking", () => {
    expect(formatInput({ user: "U9", text: "hi" })).toBe("<@U9>: hi");
  });
});
