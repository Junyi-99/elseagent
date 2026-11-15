import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MessageQueue, openStateDb, SessionStore } from "../state/index.ts";
import { Cleanup } from "./cleanup.ts";

const DAY = 24 * 60 * 60 * 1000;

test("deletes idle sessions, unused Codex threads and old attachment folders", async () => {
  // Sessions use this clock; it ends at the real time, which the folders' ages are based on.
  let now = Date.now() - 45 * DAY;
  const db = openStateDb(":memory:");
  const sessions = new SessionStore(db, () => now);
  const queue = new MessageQueue(db);
  sessions.touch("C1:1", "t1"); // idle
  sessions.touch("C1:2", "t2"); // idle, but a message is waiting
  sessions.touch("C1:3", "t3"); // replaced by t4 later
  now += 40 * DAY;
  sessions.touch("C1:3", "t4");
  sessions.touch("C1:4", "t5");
  queue.push({
    conversationKey: "C1:2",
    channel: "C1",
    ts: "9",
    threadTs: "2",
    user: "U",
    text: "x",
  });
  now += 5 * DAY;

  const workspace = mkdtempSync(join(tmpdir(), "elseagent-cleanup-"));
  const folder = (name: string, ageDays: number) => {
    const dir = join(workspace, "attachments", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "f.txt"), "12345");
    const t = new Date(now - ageDays * DAY);
    utimesSync(dir, t, t);
  };
  folder("C1-1", 40); // idle conversation
  folder("C1-2", 40); // busy
  folder("C1-3", 40); // active session: kept whatever its age
  folder("C9-9", 40); // no session, old
  folder("C9-8", 2); // no session, recent

  const deleted: string[] = [];
  const cleanup = new Cleanup({
    sessions,
    busyConversations: () => queue.conversations(),
    deleteThread: async (id) => {
      if (id === "t3") throw new Error("codex says no");
      deleted.push(id);
    },
    workspace,
    now: () => now,
  });

  const dry = await cleanup.run({ olderThanDays: 30, dryRun: true });
  expect(dry).toMatchObject({
    sessions: 1,
    conversations: ["C1:1"],
    codexThreads: 2,
    attachmentFolders: 2,
    attachmentBytes: "10 B",
  });
  expect(deleted).toEqual([]);
  expect(sessions.conversationKeys().sort()).toEqual(["C1:1", "C1:2", "C1:3", "C1:4"]);

  const res = await cleanup.run({ olderThanDays: 30, dryRun: false });
  expect(res).toMatchObject({
    sessions: 1,
    codexThreads: 1,
    codexThreadErrors: [{ threadId: "t3", error: "codex says no" }],
    attachmentFolders: 2,
  });
  expect(deleted).toEqual(["t1"]);
  expect(sessions.conversationKeys().sort()).toEqual(["C1:2", "C1:3", "C1:4"]);
  // t3 failed: still tracked, so the next cleanup tries again.
  expect(sessions.unusedThreads(now).map((t) => t.threadId)).toEqual(["t3"]);
  const left = await Array.fromAsync(
    new Bun.Glob("*").scan({ cwd: join(workspace, "attachments"), onlyFiles: false }),
  );
  expect(left.sort()).toEqual(["C1-2", "C1-3", "C9-8"]);
});
