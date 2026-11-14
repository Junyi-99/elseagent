import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { openStateDb } from "./db.ts";
import { embeddedMigrations } from "./migrate.ts";
import { MessageQueue, type NewQueuedMessage } from "./queue.ts";
import { SessionStore } from "./sessions.ts";

const DAY = 24 * 60 * 60 * 1000;

describe("migrations", () => {
  test("embedded migrations match drizzle/ exactly (run `bun run db:generate` if not)", () => {
    const fromDisk = readMigrationFiles({
      migrationsFolder: join(import.meta.dir, "../../drizzle"),
    });
    expect(embeddedMigrations()).toEqual(fromDisk);
  });

  test("create the tables and are not re-applied on reopen", () => {
    const db = openStateDb(":memory:");
    const tables = db.$client
      .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining(["__drizzle_migrations", "queue", "sessions"]));
  });
});

describe("SessionStore", () => {
  test("maps a conversation to its Codex thread and expires idle ones", () => {
    let now = 1_000 * DAY;
    const store = new SessionStore(openStateDb(":memory:"), () => now);
    expect(store.threadFor("C1:1.0", 7 * DAY)).toBeNull();

    store.touch("C1:1.0", "thread-a");
    expect(store.threadFor("C1:1.0", 7 * DAY)).toBe("thread-a");

    now += 6 * DAY;
    store.touch("C1:1.0", "thread-a"); // activity resets the idle clock
    now += 6 * DAY;
    expect(store.threadFor("C1:1.0", 7 * DAY)).toBe("thread-a");

    now += 2 * DAY; // 8 days idle
    expect(store.threadFor("C1:1.0", 7 * DAY)).toBeNull();
    expect(store.expire(7 * DAY)).toBe(1);
    expect(store.expire(7 * DAY)).toBe(0);
  });

  test("re-points a conversation to a new thread", () => {
    const store = new SessionStore(openStateDb(":memory:"));
    store.touch("D1", "old");
    store.touch("D1", "new");
    expect(store.threadFor("D1", DAY)).toBe("new");
  });
});

describe("MessageQueue", () => {
  const msg = (conversationKey: string, text: string): NewQueuedMessage => ({
    conversationKey,
    channel: "C1",
    ts: "1.0",
    threadTs: null,
    user: "U1",
    text,
  });

  test("is FIFO and reports positions", () => {
    const q = new MessageQueue(openStateDb(":memory:"));
    const a = q.push(msg("A", "a"));
    const b = q.push(msg("B", "b"));
    expect(q.pendingCount()).toBe(2);
    expect(q.position(b.id)).toBe(2);
    expect(q.claimNext()?.id).toBe(a.id);
    expect(q.position(b.id)).toBe(1);
    expect(q.claimNext()?.id).toBe(b.id);
    expect(q.claimNext()).toBeNull();
  });

  test("never runs two messages of the same conversation at once", () => {
    const q = new MessageQueue(openStateDb(":memory:"));
    const a1 = q.push(msg("A", "a1"));
    const a2 = q.push(msg("A", "a2"));
    const b1 = q.push(msg("B", "b1"));

    expect(q.claimNext()?.id).toBe(a1.id);
    expect(q.claimNext()?.id).toBe(b1.id); // a2 skipped: A is busy
    expect(q.claimNext()).toBeNull();

    q.remove(a1.id);
    expect(q.claimNext()?.id).toBe(a2.id);
  });

  test("removed messages are gone; nothing is kept as history", () => {
    const db = openStateDb(":memory:");
    const q = new MessageQueue(db);
    q.remove(q.push(msg("A", "a")).id);
    expect(db.$client.query("SELECT COUNT(*) AS n FROM queue").get()).toEqual({ n: 0 });
  });

  test("survives a restart; messages left running are handed back as interrupted", () => {
    const path = join(import.meta.dir, `.test-${crypto.randomUUID()}.sqlite`);
    try {
      const q1 = new MessageQueue(openStateDb(path));
      const running = q1.push(msg("A", "was running"));
      const waiting = q1.push(msg("B", "still waiting"));
      q1.claimNext();

      const q2 = new MessageQueue(openStateDb(path));
      expect(q2.takeInterrupted().map((m) => m.id)).toEqual([running.id]);
      expect(q2.pendingCount()).toBe(1);
      expect(q2.claimNext()).toMatchObject({ id: waiting.id, text: "still waiting" });
    } finally {
      for (const suffix of ["", "-wal", "-shm"])
        Bun.file(path + suffix)
          .delete()
          .catch(() => {});
    }
  });
});
