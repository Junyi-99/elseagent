import { z } from "zod";

export const DEFAULT_CONFIG_PATH = "/etc/elseagents/config.yaml";

const requiredString = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .trim()
    .min(1, `${name} is required`);

const slackSchema = z.object({
  botToken: requiredString("slack.botToken"),
  appToken: requiredString("slack.appToken"),
  signingSecret: z.string().optional(),
});

const codexSchema = z.object({
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
});

export const configSchema = z.object({
  slack: slackSchema,
  codex: codexSchema.prefault({}),
});

export type Config = z.infer<typeof configSchema>;
export type SlackConfig = Config["slack"];
export type CodexConfig = Config["codex"];
