import { buildThreadOptions, createCodex } from "./codex.ts";
import type { Config } from "./config/index.ts";

export interface StartOptions {
  configPath: string;
  /** Absolute path of the directory Codex works in. */
  workdir: string;
}

/** Start the agent with a validated config. */
export async function startApp(
  config: Config,
  { configPath, workdir }: StartOptions,
): Promise<void> {
  // Resolve the codex binary up front so a missing CLI fails at startup, not on the first message.
  const _codex = createCodex(config.codex);
  const threadOptions = buildThreadOptions(config.codex, workdir);

  console.log(`elseagents starting`);
  console.log(`  config:  ${configPath}`);
  console.log(`  workdir: ${threadOptions.workingDirectory}`);
  console.log(`  model:   ${threadOptions.model ?? "(codex default)"}`);
  console.log(`  effort:  ${threadOptions.modelReasoningEffort ?? "(codex default)"}`);
  // TODO: wire up Slack Bolt + Codex
}
