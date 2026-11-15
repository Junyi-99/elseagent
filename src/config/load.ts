import { dirname, resolve } from "node:path";
import { z } from "zod";
import { expandHome } from "./paths.ts";
import { type Config, configSchema, SANDBOX_MODE_ENV, SANDBOX_MODES } from "./schema.ts";

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** `codex.sandboxMode` from ELSEAGENT_SANDBOX_MODE, when the config doesn't set it. */
function sandboxModeFromEnv(
  env: Record<string, string | undefined>,
): Config["codex"]["sandboxMode"] {
  const value = env[SANDBOX_MODE_ENV]?.trim();
  if (!value) return undefined;
  const mode = SANDBOX_MODES.find((m) => m === value);
  if (!mode) {
    throw new ConfigError(`${SANDBOX_MODE_ENV} must be one of ${SANDBOX_MODES.join(", ")}`);
  }
  return mode;
}

/** Read, parse and validate a YAML config file. Relative paths in the config resolve against the file's directory. */
export async function loadConfig(
  path: string,
  env: Record<string, string | undefined> = process.env,
): Promise<Config> {
  const absPath = resolve(path);
  const file = Bun.file(absPath);
  if (!(await file.exists())) {
    throw new ConfigError(
      `Config file not found: ${absPath}\nRun \`elseagent init\` to generate one, or pass -c <path>.`,
    );
  }

  let raw: unknown;
  try {
    raw = Bun.YAML.parse(await file.text());
  } catch (err) {
    throw new ConfigError(`Failed to parse ${absPath}: ${(err as Error).message}`);
  }

  const result = configSchema.safeParse(raw ?? {});
  if (!result.success) {
    throw new ConfigError(`Invalid config in ${absPath}:\n${z.prettifyError(result.error)}`);
  }

  const config = result.data;
  const baseDir = dirname(absPath);
  config.codex.sandboxMode ??= sandboxModeFromEnv(env);
  config.workspace = resolve(baseDir, expandHome(config.workspace));
  config.stateDir = resolve(baseDir, expandHome(config.stateDir));
  // A bare command name (e.g. "codex") is looked up on PATH, so only resolve real paths.
  if (config.codex.path?.includes("/")) {
    config.codex.path = resolve(baseDir, expandHome(config.codex.path));
  }
  return config;
}
