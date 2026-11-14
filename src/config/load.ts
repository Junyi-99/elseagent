import { dirname, resolve } from "node:path";
import { z } from "zod";
import { type Config, configSchema } from "./schema.ts";

export class ConfigError extends Error {
  override name = "ConfigError";
}

/** Read, parse and validate a YAML config file. Relative paths in the config resolve against the file's directory. */
export async function loadConfig(path: string): Promise<Config> {
  const absPath = resolve(path);
  const file = Bun.file(absPath);
  if (!(await file.exists())) {
    throw new ConfigError(
      `Config file not found: ${absPath}\nRun \`elseagents init\` to generate one, or pass -c <path>.`,
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

  return resolvePaths(result.data, dirname(absPath));
}

function resolvePaths(config: Config, baseDir: string): Config {
  const { codex } = config;
  if (codex.workingDirectory) {
    codex.workingDirectory = resolve(baseDir, codex.workingDirectory);
  }
  // A bare command name (e.g. "codex") is looked up on PATH, so only resolve real paths.
  if (codex.path?.includes("/")) {
    codex.path = resolve(baseDir, codex.path);
  }
  return config;
}
