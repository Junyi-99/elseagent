import { createCodex } from "./codex.ts";
import type { Config } from "./config.ts";

/** Start the agent with a validated config. */
export async function startApp(config: Config, configPath: string): Promise<void> {
  console.log(`elseagents starting with config ${configPath}`);
  // Resolve the codex binary up front so a missing CLI fails at startup, not on the first message.
  const _codex = createCodex(config.codex);
  console.log(
    `codex sandbox: ${config.codex.sandboxMode}, approval: ${config.codex.approvalPolicy}`,
  );
  // TODO: wire up Slack Bolt + Codex
}
