import { Codex } from "@openai/codex-sdk";
import type { Config } from "./config.ts";
import { ConfigError } from "./config.ts";

/**
 * Create a Codex client. The codex CLI binary is resolved in order:
 * 1. `codex.path` from config (absolute path or a command name on PATH)
 * 2. the @openai/codex package in node_modules (only available when running from source)
 * 3. `codex` on PATH (the compiled single-file build has no node_modules)
 */
export function createCodex(config: Config["codex"]): Codex {
  const options = {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  };

  if (config.path) {
    const resolved = Bun.which(config.path);
    if (!resolved) {
      throw new ConfigError(`codex.path not found or not executable: ${config.path}`);
    }
    return new Codex({ ...options, codexPathOverride: resolved });
  }

  try {
    return new Codex(options);
  } catch {
    const onPath = Bun.which("codex");
    if (!onPath) {
      throw new ConfigError(
        "Could not find the codex CLI. Install it (e.g. `npm i -g @openai/codex`) " +
          "or set codex.path in the config.",
      );
    }
    return new Codex({ ...options, codexPathOverride: onPath });
  }
}
