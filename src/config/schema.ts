import type { ModelReasoningEffort } from "@openai/codex-sdk";
import { z } from "zod";

/** Shown as-is in help; expanded with `expandHome` before use. */
export const DEFAULT_CONFIG_PATH = "~/.elseagent.yaml";

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

function isTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const positiveInt = (name: string) =>
  z.int(`${name} must be a whole number`).positive(`${name} must be greater than 0`);

/** The agent itself: its role, workspace, limits and state. These are top-level options. */
const agentSchema = z.object({
  // The agent's role, passed to Codex as developer instructions. Empty = plain Codex session.
  prompt: z
    .string()
    .transform((s) => s.trim() || undefined)
    .optional(),
  // Codex turns (one `codex exec` each) running at the same time. Idle sessions don't count.
  maxConcurrent: positiveInt("maxConcurrent").default(32),
  // Messages waiting for a free slot; beyond this new messages are turned away.
  maxQueue: positiveInt("maxQueue").default(1024),
  // A turn running longer than this is aborted and its slot freed.
  turnTimeoutMinutes: positiveInt("turnTimeoutMinutes").default(30),
  // A conversation with no activity for this long is forgotten; its next message starts fresh.
  sessionIdleDays: positiveInt("sessionIdleDays").default(7),
  // The directory Codex works in (repositories, files). Created if missing. `~` is expanded;
  // relative paths resolve against the config file.
  workspace: z.string().trim().min(1).default("~/workspace"),
  // Where the agent keeps its SQLite state (session mapping, message queue). `~` is expanded;
  // relative paths resolve against the config file.
  stateDir: z.string().trim().min(1).default("~/.elseagent"),
  // Default time zone for scheduled tasks (IANA name). Defaults to the server's time zone.
  timezone: z
    .string()
    .trim()
    .refine(isTimezone, "timezone must be an IANA time zone, e.g. Asia/Shanghai")
    .default(() => Intl.DateTimeFormat().resolvedOptions().timeZone),
});

// Only what the user may override. Agent-mode behaviour (sandbox, approvals, git check)
// is fixed in src/codex.ts; everything else uses the Codex defaults.
const codexSchema = z.object({
  path: z.string().trim().min(1).optional(),
  model: z.string().trim().min(1).optional(),
  reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
  // workspace-write (default): commands may only write in the working directory, no network.
  // danger-full-access: no Codex sandbox; for containers, where the container is the sandbox.
  sandboxMode: z.enum(["workspace-write", "danger-full-access"]).optional(),
});

const slackSchema = z.object(
  {
    botToken: requiredString("channels.slack.botToken"),
    appToken: requiredString("channels.slack.appToken"),
    // Public Slack channels to join at startup, by name (with or without #) or ID.
    join: z.array(z.string().trim().min(1)).default([]),
  },
  { error: "channels.slack must be a section with botToken and appToken" },
);

const USER_ID_ERROR = "channels.telegram.allowedUsers entries must be numeric Telegram user IDs";
const telegramUserId = z
  .union([z.int(USER_ID_ERROR), z.string().trim().regex(/^\d+$/, USER_ID_ERROR)], {
    error: USER_ID_ERROR,
  })
  .transform(String);

const telegramSchema = z.object(
  {
    botToken: requiredString("channels.telegram.botToken"),
    // Telegram user IDs that may talk to the agent; /start tells a user their ID.
    allowedUsers: z.array(telegramUserId).default([]),
  },
  { error: "channels.telegram must be a section with botToken" },
);

/** Every config section; docs/config.md must document each of their fields. */
export const configSections = {
  "": agentSchema, // top level
  codex: codexSchema,
  "channels.slack": slackSchema,
  "channels.telegram": telegramSchema,
};

/**
 * Environment variables for the agent: credentials and settings for the tools Codex uses
 * (CODEX_API_KEY, GH_TOKEN, CLOUDFLARE_API_TOKEN, KUBECONFIG…), so one config file is enough.
 */
const envSchema = z.record(
  z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  // YAML may read values like 8080 or true as numbers/booleans; variables are strings.
  z.union([z.string(), z.number(), z.boolean()]).transform(String),
  {
    error: (issue) =>
      issue.code === "invalid_key"
        ? "env names must be valid variable names (letters, digits and _)"
        : undefined,
  },
);

/** A section that may be left out; an empty one (`slack:` alone, parsed as null) too. */
const optionalSection = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => v ?? undefined, schema.optional());

const NO_CHANNEL = "configure at least one channel: channels.slack or channels.telegram (or both)";

// Where people talk to the agent: each channel is turned on by its section. At least one.
const channelsSchema = z.preprocess(
  (v) => v ?? {},
  z
    .object(
      {
        slack: optionalSection(slackSchema),
        telegram: optionalSection(telegramSchema),
      },
      { error: "channels must be a section with slack and/or telegram" },
    )
    .refine((c) => c.slack || c.telegram, { error: NO_CHANNEL }),
);

export const configSchema = agentSchema.extend({
  // Optional sections may be missing or empty (`codex:` with nothing under it parses as null).
  codex: z.preprocess((v) => v ?? {}, codexSchema),
  channels: channelsSchema,
  env: z.preprocess((v) => v ?? {}, envSchema),
});

export type Config = z.infer<typeof configSchema>;
export type ChannelsConfig = Config["channels"];
export type SlackConfig = NonNullable<ChannelsConfig["slack"]>;
export type TelegramConfig = NonNullable<ChannelsConfig["telegram"]>;
export type CodexConfig = Config["codex"];
