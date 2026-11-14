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

const agentSchema = z.object({
  // The agent's role, passed to Codex as developer instructions. Empty = plain Codex session.
  prompt: z
    .string()
    .transform((s) => s.trim() || undefined)
    .optional(),
});

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
  // Public channels to join at startup, by name (with or without #) or ID.
  channels: z.array(z.string().trim().min(1)).default([]),
});

export const configSchema = z.object({
  // Sections whose options are all commented out parse as null; treat them (or a missing
  // section) as {}.
  agent: z.preprocess((v) => v ?? {}, agentSchema),
  codex: z.preprocess((v) => v ?? {}, codexSchema),
  slack: slackSchema,
});

export type Config = z.infer<typeof configSchema>;
export type AgentConfig = Config["agent"];
export type SlackConfig = Config["slack"];
export type CodexConfig = Config["codex"];
