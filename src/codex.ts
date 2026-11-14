import { Codex, type CodexOptions, type ThreadOptions } from "@openai/codex-sdk";
import { buildInstructions } from "./agent/instructions.ts";
import type { CodexConfig } from "./config/index.ts";
import { ConfigError } from "./config/index.ts";
import { TOKEN_ENV, TURN_HEADER } from "./mcp/server.ts";

type CodexConfigValue = NonNullable<CodexOptions["config"]>[string];

/** Fixed agent-mode settings: act autonomously inside the working directory, never stop to ask. */
export const AGENT_THREAD_DEFAULTS = {
  sandboxMode: "workspace-write",
  approvalPolicy: "never",
  skipGitRepoCheck: true,
} as const satisfies ThreadOptions;

/** Options for every Codex thread: agent-mode defaults plus the user's overrides. */
export function buildThreadOptions(config: CodexConfig, workingDirectory: string): ThreadOptions {
  return {
    ...AGENT_THREAD_DEFAULTS,
    sandboxMode: config.sandboxMode ?? AGENT_THREAD_DEFAULTS.sandboxMode,
    workingDirectory,
    model: config.model,
    modelReasoningEffort: config.reasoningEffort,
  };
}

/** How a turn reaches the elseagent MCP tools served by this process. */
export interface McpRegistration {
  url: string;
  token: string;
  /** Queue message id of the turn; tells the tools who is calling. */
  turnId: number;
}

export interface CodexClientOptions {
  codexPath: string;
  /** The agent's role (agent.prompt). */
  prompt?: string;
  /** Registers the elseagent MCP server for this turn. */
  mcp?: McpRegistration;
  /** Variables from the config's `env:`, made available to the commands Codex runs. */
  shellEnv?: Record<string, string>;
}

/**
 * Codex options for one turn. The built-in Slack instructions plus the agent prompt become
 * Codex's `developer_instructions` (on top of Codex's own system prompt). With `mcp`, the
 * elseagent MCP server is registered; its tools are trusted, so they run without approval
 * (with `approvalPolicy: never`, anything needing approval would be refused).
 */
export function buildCodexOptions({
  codexPath,
  prompt,
  mcp,
  shellEnv = {},
}: CodexClientOptions): CodexOptions {
  const config: NonNullable<CodexOptions["config"]> = {
    developer_instructions: buildInstructions(prompt),
  };
  // The commands Codex runs get the configured variables explicitly (`set`), whatever Codex's
  // own default filtering of names like *TOKEN* is, and never the MCP token (`exclude`).
  const policy: Record<string, CodexConfigValue> = {};
  if (Object.keys(shellEnv).length > 0) policy.set = shellEnv;
  if (mcp) policy.exclude = [TOKEN_ENV];
  if (Object.keys(policy).length > 0) config.shell_environment_policy = policy;
  if (!mcp) return { codexPathOverride: codexPath, config };
  config.mcp_servers = {
    elseagent: {
      url: mcp.url,
      // The token travels in the environment, not on the command line, and is excluded
      // from the commands' environment above.
      bearer_token_env_var: TOKEN_ENV,
      http_headers: { [TURN_HEADER]: String(mcp.turnId) },
      default_tools_approval_mode: "approve",
    },
  };
  return {
    codexPathOverride: codexPath,
    config,
    // Setting `env` replaces the inherited environment, so pass it along.
    env: { ...(process.env as Record<string, string>), [TOKEN_ENV]: mcp.token },
  };
}

/**
 * Find the codex CLI: `codex.path` (absolute path or command name) or `codex` on PATH. The
 * bundled @openai/codex binary is never used: elseagent ships as a single file without
 * node_modules, so source and compiled builds behave the same.
 */
export function resolveCodexPath(config: CodexConfig, searchPath = process.env.PATH): string {
  const command = config.path ?? "codex";
  const resolved = Bun.which(command, { PATH: searchPath });
  if (!resolved) {
    throw new ConfigError(
      config.path
        ? `codex.path not found or not executable: ${config.path}`
        : "Could not find `codex` on PATH. Install it (e.g. `npm i -g @openai/codex`) " +
            "or set codex.path in the config.",
    );
  }
  return resolved;
}

/** A Codex client for one turn. */
export function createCodex(options: CodexClientOptions): Codex {
  return new Codex(buildCodexOptions(options));
}
