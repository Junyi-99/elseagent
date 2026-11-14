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

/** Marker used by config.example.yaml for values the user must fill in. */
export const PLACEHOLDER = "REPLACE-ME";

const requiredString = (name: string) =>
  z
    .string({ error: `${name} is required` })
    .trim()
    .min(1, `${name} is required`)
    .refine(
      (v) => !v.includes(PLACEHOLDER),
      `${name} is still the placeholder; set the real value`,
    );

const positiveInt = (name: string) =>
  z.int(`${name} must be a whole number`).positive(`${name} must be greater than 0`);

const agentSchema = z.object({
  // The agent's role, passed to Codex as developer instructions. Empty = plain Codex session.
  prompt: z
    .string()
    .transform((s) => s.trim() || undefined)
    .optional(),
  // Codex turns (one `codex exec` each) running at the same time. Idle sessions don't count.
  maxConcurrent: positiveInt("agent.maxConcurrent").default(16),
  // Messages waiting for a free slot; beyond this new messages are turned away.
  maxQueue: positiveInt("agent.maxQueue").default(100),
  // A turn running longer than this is aborted and its slot freed.
  turnTimeoutMinutes: positiveInt("agent.turnTimeoutMinutes").default(30),
  // A conversation with no activity for this long is forgotten; its next message starts fresh.
  sessionIdleDays: positiveInt("agent.sessionIdleDays").default(7),
});

// Only what the user may override. Agent-mode behaviour (sandbox, approvals, git check)
// is fixed in src/codex.ts; everything else uses the Codex defaults.
const codexSchema = z.object({
  path: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
});

const slackSchema = z.object(
  {
    botToken: requiredString("slack.botToken"),
    appToken: requiredString("slack.appToken"),
    // Public channels to join at startup, by name (with or without #) or ID.
    channels: z.array(z.string().trim().min(1)).default([]),
  },
  { error: "slack section is required (slack.botToken, slack.appToken)" },
);

/** Every config section; docs/config.md must document each of their fields. */
export const configSections = {
  agent: agentSchema,
  codex: codexSchema,
  slack: slackSchema,
};

export const configSchema = z.object({
  // Optional sections may be missing or empty (`agent:` with nothing under it parses as null).
  agent: z.preprocess((v) => v ?? {}, agentSchema),
  codex: z.preprocess((v) => v ?? {}, codexSchema),
  slack: slackSchema,
});

export type Config = z.infer<typeof configSchema>;
export type AgentConfig = Config["agent"];
export type SlackConfig = Config["slack"];
export type CodexConfig = Config["codex"];
