import { Codex, type ThreadOptions } from "@openai/codex-sdk";
import type { CodexConfig } from "./config/index.ts";
import { ConfigError } from "./config/index.ts";

/** Fixed agent-mode settings: act autonomously inside the workdir, never stop to ask. */
export const AGENT_THREAD_DEFAULTS = {
  sandboxMode: "workspace-write",
  approvalPolicy: "never",
  skipGitRepoCheck: true,
} as const satisfies ThreadOptions;

/** Options for every Codex thread: agent-mode defaults plus the user's model overrides. */
export function buildThreadOptions(config: CodexConfig, workingDirectory: string): ThreadOptions {
  return {
    ...AGENT_THREAD_DEFAULTS,
    workingDirectory,
    model: config.model,
    modelReasoningEffort: config.reasoningEffort,
  };
}

/**
 * Create a Codex client using the codex CLI from `codex.path` (absolute path or command name)
 * or `codex` on PATH. The bundled @openai/codex binary is never used: elseagents ships as a
 * single file without node_modules, so source and compiled builds behave the same.
 */
export function createCodex(config: CodexConfig, searchPath = process.env.PATH): Codex {
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
  return new Codex({ codexPathOverride: resolved });
}
