import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Admin, type Caller } from "../agent/admin.ts";
import type { RunningTurn } from "../agent/scheduler.ts";
import { ScheduleRunner } from "../agent/schedules.ts";
import { MessageQueue, openStateDb, ScheduleStore, SessionStore } from "../state/index.ts";
import { type McpEndpoint, startMcpServer, TURN_HEADER } from "./server.ts";

// A running turn (id 1) in conversation C1:1.0, plus another one (id 2) that can be cancelled.
const turns: RunningTurn[] = [1, 2].map((id) => ({
  message: {
    id,
    conversationKey: `C1:${id}.0`,
    channel: "C1",
    ts: `${id}.0`,
    threadTs: `${id}.0`,
    user: `U${id}`,
    text: `message ${id}`,
    scheduleId: null,
    mode: "direct" as const,
  },
  startedAt: Date.now() - 65_000,
}));
const cancelled: [string, string][] = [];
const ensured: string[] = [];

const db = openStateDb(":memory:");
const queue = new MessageQueue(db);
const sessions = new SessionStore(db);
const schedules = new ScheduleStore(db);
const scheduler = {
  runningTurns: () => turns,
  cancel: (key: string, by: string) => {
    cancelled.push([key, by]);
    return turns.some((t) => t.message.conversationKey === key);
  },
};
const admin = new Admin({
  scheduler,
  queue,
  sessions,
  schedules,
  scheduleRunner: new ScheduleRunner(schedules, { submit: () => ({ status: "started" }) }),
  ensureChannel: async (ref) => {
    ensured.push(ref);
    if (ref === "#secret") throw new Error("I can't post in #secret; invite me there first");
    return "C_OPS";
  },
  limits: { maxConcurrent: 16, maxQueue: 1024, turnTimeoutMinutes: 30, sessionIdleDays: 7 },
  defaultTimezone: "UTC",
});

let endpoint: McpEndpoint;
beforeAll(() => {
  endpoint = startMcpServer(admin, (id): Caller | null => {
    const turn = turns.find((t) => t.message.id === id);
    return turn
      ? {
          user: turn.message.user,
          channel: turn.message.channel,
          conversationKey: turn.message.conversationKey,
        }
      : null;
  });
});
afterAll(() => endpoint.stop());

async function connect(turnId: number, token = endpoint.token) {
  const client = new Client({ name: "test", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL(endpoint.url), {
      requestInit: { headers: { authorization: `Bearer ${token}`, [TURN_HEADER]: String(turnId) } },
    }),
  );
  return client;
}

type Result = { content: { type: string; text: string }[]; isError?: boolean };
async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res = (await client.callTool({ name, arguments: args })) as Result;
  const text = res.content[0]?.text ?? "";
  return { text, isError: res.isError ?? false, json: () => JSON.parse(text) };
}

describe("elseagent MCP server", () => {
  test("rejects requests without the token or from an unknown turn", async () => {
    expect(connect(1, "wrong")).rejects.toThrow();
    expect(connect(99)).rejects.toThrow();
  });

  test("lists the admin and schedule tools", async () => {
    const client = await connect(1);
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "cancel_turn",
      "forget_session",
      "list_queue",
      "list_sessions",
      "remove_queued",
      "schedule_create",
      "schedule_delete",
      "schedule_list",
      "schedule_run_now",
      "status",
      "thread_follow",
    ]);
    await client.close();
  });

  test("status shows running turns, queue and limits", async () => {
    queue.push({
      conversationKey: "D9",
      channel: "D9",
      ts: "5.0",
      threadTs: null,
      user: "U9",
      text: "waiting",
    });
    sessions.touch("C1:1.0", "thread-a", "1.0");
    const client = await connect(1);
    const status = (await callTool(client, "status")).json();
    expect(status.running.map((r: { conversation: string }) => r.conversation)).toEqual([
      "C1:1.0",
      "C1:2.0",
    ]);
    expect(status.running[0].runningForSeconds).toBeGreaterThanOrEqual(65);
    expect(status).toMatchObject({ queued: 1, sessions: 1, schedules: 0 });
    expect(status.limits.maxConcurrent).toBe(16);

    const queued = (await callTool(client, "list_queue")).json();
    expect(queued[0]).toMatchObject({ position: 1, conversation: "D9", text: "waiting" });
    await client.close();
  });

  test("cancel_turn stops another conversation's turn, as the caller, but not its own", async () => {
    const client = await connect(1);
    expect((await callTool(client, "cancel_turn", { conversation: "C1:2.0" })).isError).toBe(false);
    expect(cancelled).toContainEqual(["C1:2.0", "U1"]);
    const self = await callTool(client, "cancel_turn", { conversation: "C1:1.0" });
    expect(self).toMatchObject({ isError: true });
    expect(self.text).toContain("can't cancel itself");
    await client.close();
  });

  test("schedule_create defaults to the caller's channel, or joins the named one", async () => {
    const client = await connect(1);
    const here = (
      await callTool(client, "schedule_create", {
        name: "Here",
        cron: "0 9 * * *",
        prompt: "check",
      })
    ).json();
    expect(here).toMatchObject({ channel: "C1", createdBy: "U1", timezone: "UTC" });

    const ops = (
      await callTool(client, "schedule_create", {
        name: "Ops",
        cron: "0 9 * * 1-5",
        prompt: "check CI",
        channel: "#ops",
        timezone: "Asia/Shanghai",
      })
    ).json();
    expect(ops).toMatchObject({ channel: "C_OPS", timezone: "Asia/Shanghai" });
    expect(ops.nextRun).toMatch(/09:00 \(Asia\/Shanghai\)$/);
    expect(ensured).toContain("#ops");

    const bad = await callTool(client, "schedule_create", {
      name: "x",
      cron: "* * * * *",
      prompt: "p",
    });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("more often");
    const privateCh = await callTool(client, "schedule_create", {
      name: "x",
      cron: "0 9 * * *",
      prompt: "p",
      channel: "#secret",
    });
    expect(privateCh.text).toContain("invite me");

    expect((await callTool(client, "schedule_list")).json()).toHaveLength(2);
    expect((await callTool(client, "schedule_delete", { id: here.id })).text).toContain("Deleted");
    expect((await callTool(client, "schedule_list")).json()).toHaveLength(1);
    expect((await callTool(client, "schedule_run_now", { id: ops.id })).text).toContain("Queued");
    await client.close();
  });

  test("forget_session and remove_queued", async () => {
    const client = await connect(1);
    expect((await callTool(client, "forget_session", { conversation: "C1:1.0" })).isError).toBe(
      false,
    );
    expect((await callTool(client, "forget_session", { conversation: "C1:1.0" })).isError).toBe(
      true,
    );
    const [first] = (await callTool(client, "list_queue")).json();
    expect((await callTool(client, "remove_queued", { id: first.id })).isError).toBe(false);
    expect((await callTool(client, "list_queue")).json()).toEqual([]);
    await client.close();
  });

  test("thread_follow mutes and unmutes the caller's thread (or another one)", async () => {
    const client = await connect(1);
    const off = await callTool(client, "thread_follow", { follow: false });
    expect(off.text).toContain("Stopped following C1:1.0");
    expect(sessions.followState("C1:1.0")?.muted).toBe(true);
    await callTool(client, "thread_follow", { follow: true });
    expect(sessions.followState("C1:1.0")?.muted).toBe(false);
    await callTool(client, "thread_follow", { follow: false, conversation: "C1:2.0" });
    expect(sessions.followState("C1:2.0")?.muted).toBe(true);
    const dm = await callTool(client, "thread_follow", { follow: false, conversation: "D1" });
    expect(dm.isError).toBe(true);
    await client.close();
  });
});
