import { join } from "node:path";
import { Scheduler } from "./agent/scheduler.ts";
import { createTurnRunner, REACTIONS } from "./agent/turn.ts";
import { buildThreadOptions, createCodex } from "./codex.ts";
import type { Config } from "./config/index.ts";
import { conversationKey, createSlackBot, type MessageHandler } from "./slack/index.ts";
import { MessageQueue, openStateDb, SessionStore } from "./state/index.ts";

export interface StartOptions {
  configPath: string;
  /** Absolute path of the directory Codex works in. */
  workingDirectory: string;
  /** Validate everything and print the summary, but do not connect to Slack. */
  dryRun?: boolean;
}

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

/** Start the agent with a validated config. */
export async function startApp(
  config: Config,
  { configPath, workingDirectory, dryRun = false }: StartOptions,
): Promise<void> {
  // Resolve the codex binary up front so a missing CLI fails at startup, not on the first message.
  const codex = createCodex(config.codex, config.agent.prompt);
  const threadOptions = buildThreadOptions(config.codex, workingDirectory);

  const { prompt, maxConcurrent, maxQueue, turnTimeoutMinutes, sessionIdleDays, stateDir } =
    config.agent;
  printSummary([
    ["config", configPath],
    ["working directory", workingDirectory],
    ["state directory", stateDir],
    ["model", threadOptions.model ?? "(codex default)"],
    ["reasoning effort", threadOptions.modelReasoningEffort ?? "(codex default)"],
    ["prompt", prompt ? `${prompt.length} chars` : "(none)"],
    [
      "limits",
      `${maxConcurrent} concurrent, queue ${maxQueue}, ` +
        `turn timeout ${turnTimeoutMinutes}m, session idle ${sessionIdleDays}d`,
    ],
  ]);
  if (dryRun) {
    console.log("dry run: config OK, not connecting to Slack");
    return;
  }

  const bot = await createSlackBot(config.slack);
  const { teamId, userId } = bot.identity;
  // One database per Slack bot, so several agents can share a state directory.
  const dbPath = join(stateDir, `${teamId}-${userId}.sqlite`);
  const db = openStateDb(dbPath);
  const sessions = new SessionStore(db);
  const queue = new MessageQueue(db);
  const sessionIdleMs = sessionIdleDays * DAY;

  const scheduler = new Scheduler(
    queue,
    createTurnRunner({
      codex,
      sessions,
      threadOptions,
      replyTo: bot.replyTo,
      turnTimeoutMs: turnTimeoutMinutes * MINUTE,
      sessionIdleMs,
    }),
    {
      maxConcurrent,
      maxQueue,
      onError: (err, m) => console.warn(`turn for ${m.conversationKey} failed: ${err}`),
    },
  );

  // Messages that were mid-turn when the previous process stopped.
  for (const message of queue.takeInterrupted()) {
    const reply = bot.replyTo(message);
    await reply.unreact(REACTIONS.working);
    await reply.react(REACTIONS.failed);
    await reply
      .post("The agent restarted while working on this. Send it again to retry.")
      .catch(() => {});
  }

  const onMessage: MessageHandler = async (message, reply) => {
    if (!message.text) {
      await reply.post("Hi! Mention me with what you need, and I'll get to work.");
      return;
    }
    const result = scheduler.submit({
      conversationKey: conversationKey(message),
      channel: message.channel,
      ts: message.ts,
      threadTs: message.threadTs ?? null,
      user: message.user,
      text: message.text,
    });
    if (result.status === "queued") {
      await reply.react(REACTIONS.queued);
    } else if (result.status === "rejected") {
      await reply.post("I'm too busy right now. Please try again in a while.");
    }
  };

  await bot.start(onMessage);
  console.log(`slack: connected as @${bot.identity.name} (${userId}), state ${dbPath}`);
  scheduler.pump(); // pick up messages still queued from before a restart

  const expireSessions = () => {
    const removed = sessions.expire(sessionIdleMs);
    if (removed) console.log(`sessions: forgot ${removed} idle conversation(s)`);
  };
  expireSessions();
  const gc = setInterval(expireSessions, 60 * MINUTE);

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, stopping`);
    clearInterval(gc);
    await bot.stop(); // no new messages
    await scheduler.stop(); // abort running turns; they tell their threads
    db.$client.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

function printSummary(rows: [label: string, value: string][]): void {
  const width = Math.max(...rows.map(([label]) => label.length)) + 1;
  console.log("elseagent starting");
  for (const [label, value] of rows) {
    console.log(`  ${`${label}:`.padEnd(width)} ${value}`);
  }
}
