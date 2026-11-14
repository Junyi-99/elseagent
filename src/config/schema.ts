import type { ModelReasoningEffort } from "@openai/codex-sdk";
import { z } from "zod";

export const DEFAULT_CONFIG_PATH = "/etc/elseagents/config.yaml";

const REASONING_EFFORTS = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
  "ultra",
  "persistent",
] as const satisfies readonly ModelReasoningEffort[];

const requiredString = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .trim()
    .min(1, `${name} is required`);

// Only what the user may override. Agent-mode behaviour (sandbox, approvals, git check)
// is fixed in src/codex.ts; everything else uses the Codex defaults.
const codexSchema = z.object({
  path: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
});

const slackSchema = z.object({
  botToken: requiredString("slack.botToken"),
  appToken: requiredString("slack.appToken"),
  signingSecret: z.string().optional(),
});

export const configSchema = z.object({
  // `codex:` with every option commented out parses as null; treat it (or a missing section) as {}.
  codex: z.preprocess((v) => v ?? {}, codexSchema),
  slack: slackSchema,
});

export type Config = z.infer<typeof configSchema>;
export type SlackConfig = Config["slack"];
export type CodexConfig = Config["codex"];
