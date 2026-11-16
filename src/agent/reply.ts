/** What Codex returns at the end of a turn (enforced with the SDK's `outputSchema`). */
export interface AgentReply {
  /** False: stay silent (honored for scheduled runs and messages not addressed to the agent). */
  reply: boolean;
  /** Markdown posted to the chat. */
  message: string;
  /** Options shown as buttons; empty when there is no decision to make. */
  choices: string[];
  /** Paths of files to send with the message. */
  files: string[];
}

/** JSON schema for AgentReply, in the strict form structured outputs require. */
export const REPLY_SCHEMA = {
  type: "object",
  properties: {
    reply: {
      type: "boolean",
      description:
        "Whether to post your message. Always true, except for scheduled checks with nothing to report " +
        "or a message not addressed to you that you decide not to answer.",
    },
    message: { type: "string", description: "Your reply, as Markdown (empty when not replying)." },
    choices: {
      type: "array",
      items: { type: "string" },
      description: "2 to 5 short options for the user to pick from, or empty.",
    },
    files: {
      type: "array",
      items: { type: "string" },
      description:
        "Paths of files to send with your message (relative to the working directory, or " +
        "absolute), e.g. a chart, report or export you made; empty otherwise.",
    },
  },
  required: ["reply", "message", "choices", "files"],
  additionalProperties: false,
} as const;

/** Slack limits: at most 25 buttons per block, 75 characters per button label. */
const MAX_CHOICES = 5;
const MAX_CHOICE_LENGTH = 75;

/** Parse Codex's final response. Anything that isn't the expected JSON is posted as plain text. */
export function parseReply(finalResponse: string): AgentReply {
  try {
    const raw = JSON.parse(finalResponse) as Partial<AgentReply>;
    if (typeof raw.message !== "string") throw new Error("no message");
    const choices = (Array.isArray(raw.choices) ? raw.choices : [])
      .filter((c): c is string => typeof c === "string")
      .map((c) => c.trim())
      .filter((c, i, all) => c && all.indexOf(c) === i)
      .slice(0, MAX_CHOICES)
      .map((c) => (c.length > MAX_CHOICE_LENGTH ? `${c.slice(0, MAX_CHOICE_LENGTH - 1)}…` : c));
    const files = (Array.isArray(raw.files) ? raw.files : []).filter(
      (f): f is string => typeof f === "string" && f.trim() !== "",
    );
    return { reply: raw.reply !== false, message: raw.message, choices, files };
  } catch {
    return { reply: true, message: finalResponse, choices: [], files: [] };
  }
}
