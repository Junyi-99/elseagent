import { dirname, resolve } from "node:path";
import { z } from "zod";

export const DEFAULT_CONFIG_PATH = "/etc/elseagents/config.yaml";

const requiredString = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .trim()
    .min(1, `${name} is required`);

export const configSchema = z.object({
  slack: z.object({
    botToken: requiredString("slack.botToken"),
    appToken: requiredString("slack.appToken"),
    signingSecret: z.string().optional(),
  }),
  codex: z
    .object({
      path: z.string().optional(),
      apiKey: z.string().optional(),
      baseUrl: z.url().optional(),
      model: z.string().optional(),
      workingDirectory: z.string().optional(),
      skipGitRepoCheck: z.boolean().default(false),
      sandboxMode: z
        .enum(["read-only", "workspace-write", "danger-full-access"])
        .default("workspace-write"),
      approvalPolicy: z.enum(["never", "on-request", "on-failure", "untrusted"]).default("never"),
      reasoningEffort: z.enum(["minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
      networkAccessEnabled: z.boolean().optional(),
    })
    .prefault({}),
});

export type Config = z.infer<typeof configSchema>;

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

  const config = result.data;
  const baseDir = dirname(absPath);
  if (config.codex.workingDirectory) {
    config.codex.workingDirectory = resolve(baseDir, config.codex.workingDirectory);
  }
  if (config.codex.path?.includes("/")) {
    config.codex.path = resolve(baseDir, config.codex.path);
  }
  return config;
}

export const CONFIG_TEMPLATE = `# elseagents configuration
# Default location: ${DEFAULT_CONFIG_PATH} (override with \`elseagents -c <path>\`)

slack:
  # Bot User OAuth Token (xoxb-...)
  botToken: ""
  # App-level token with connections:write scope, used for Socket Mode (xapp-...)
  appToken: ""
  # Only needed when using HTTP mode instead of Socket Mode
  # signingSecret: ""

codex:
  # Path to the codex CLI binary. Omit to use the bundled @openai/codex (when run from source)
  # or \`codex\` on PATH (required for the compiled single-file build).
  # path: /usr/local/bin/codex
  # API key for Codex. Omit to use the credentials from \`codex login\`.
  # apiKey: ""
  # baseUrl: https://api.openai.com/v1
  # Model name. Omit to use the Codex default.
  # model: ""
  # Directory the agent works in. Relative paths resolve against this file. Defaults to the process cwd.
  # workingDirectory: /var/lib/elseagents/workspace
  # Allow running outside a git repository
  skipGitRepoCheck: false
  # read-only | workspace-write | danger-full-access
  sandboxMode: workspace-write
  # never | on-request | on-failure | untrusted
  approvalPolicy: never
  # minimal | low | medium | high | xhigh | max
  # reasoningEffort: medium
  # networkAccessEnabled: false
`;
