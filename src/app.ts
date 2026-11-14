import { buildThreadOptions, createCodex } from "./codex.ts";
import type { Config } from "./config/index.ts";
import { createSlackBot, type MessageHandler } from "./slack/index.ts";

export interface StartOptions {
  configPath: string;
  /** Absolute path of the directory Codex works in. */
  workdir: string;
  /** Validate everything and print the summary, but do not connect to Slack. */
  dryRun?: boolean;
}

/** Start the agent with a validated config. */
export async function startApp(
  config: Config,
  { configPath, workdir, dryRun = false }: StartOptions,
): Promise<void> {
  // Resolve the codex binary up front so a missing CLI fails at startup, not on the first message.
  const _codex = createCodex(config.codex, config.agent);
  const threadOptions = buildThreadOptions(config.codex, workdir);

  console.log(`elseagents starting`);
  console.log(`  config:  ${configPath}`);
  console.log(`  workdir: ${threadOptions.workingDirectory}`);
  console.log(`  model:   ${threadOptions.model ?? "(codex default)"}`);
  console.log(`  effort:  ${threadOptions.modelReasoningEffort ?? "(codex default)"}`);
  console.log(
    `  prompt:  ${config.agent.prompt ? `${config.agent.prompt.length} chars` : "(none)"}`,
  );
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
