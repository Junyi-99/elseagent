import { buildThreadOptions, createCodex } from "./codex.ts";
import type { Config } from "./config/index.ts";
import { createSlackBot, type MessageHandler } from "./slack/index.ts";

export interface StartOptions {
  configPath: string;
  /** Absolute path of the directory Codex works in. */
  workingDirectory: string;
  /** Validate everything and print the summary, but do not connect to Slack. */
  dryRun?: boolean;
}

/** Start the agent with a validated config. */
export async function startApp(
  config: Config,
  { configPath, workingDirectory, dryRun = false }: StartOptions,
): Promise<void> {
  // Resolve the codex binary up front so a missing CLI fails at startup, not on the first message.
  const _codex = createCodex(config.codex, config.agent.prompt);
  const threadOptions = buildThreadOptions(config.codex, workingDirectory);

  const { prompt, maxConcurrent, maxQueue, turnTimeoutMinutes, sessionIdleDays } = config.agent;
  printSummary([
    ["config", configPath],
    ["working directory", workingDirectory],
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

  // TODO: replace with the Codex agent. For now, acknowledge to prove the round trip works.
  const onMessage: MessageHandler = async (message, reply) => {
    console.log(`slack: <${message.user}> ${message.isDirect ? "(DM) " : ""}${message.text}`);
    await reply.react("eyes");
    await reply.post(`Received: ${message.text || "(empty)"}`);
  };

  const bot = await createSlackBot(config.slack, onMessage);
  await bot.start();
  console.log(`slack: connected as @${bot.identity.name} (${bot.identity.userId})`);

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, disconnecting`);
    await bot.stop();
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
