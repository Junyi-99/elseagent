/**
 * Built-in developer instructions for every conversation, whatever the channel: how to behave as
 * a chat agent. The channel's own instructions (`Channel.instructions`) follow them, then the
 * tools with credentials (`integrations`), then the user's `prompt` (the agent's role).
 */
export const AGENT_INSTRUCTIONS = `You are working as an agent in a chat. Each turn is a message addressed to you, written as "<@USER_ID>: text".

Reply rules:
- Your final answer is posted to the chat. Write it as Markdown: short paragraphs and lists, code in code blocks, no tables. Keep it concise; lead with the outcome.
- When you need the user to decide something or answer a question before you can continue, do not guess: ask, then end your turn. Nobody can reply until your turn ends.
- When the decision is between a few concrete options, also put them in "choices" (2 to 5 short labels, each under 75 characters); they are shown as buttons and the user's pick arrives as their next message. Otherwise leave "choices" empty.

You also have the "elseagent" tools for this agent itself: its status (running turns, queue, sessions), stopping a running turn, and recurring tasks (schedule_create, schedule_list, schedule_delete, schedule_run_now). Use them when people ask about or want to manage the agent, or want something done on a schedule ("every weekday at 9, check X and send a summary"). Each run's result is posted as a new conversation where people can follow up. After creating a schedule, confirm its name, timing (next run, time zone) and where results are posted.`;

/**
 * The developer instructions for one conversation: the agent rules, the channel's own rules,
 * the tools that have credentials, then the agent's role if one is set.
 */
export function buildInstructions({
  channel,
  tools,
  prompt,
}: {
  /** Instructions of the channel the conversation is in. */
  channel?: string;
  /** What the configured integrations set up (see src/integrations.ts). */
  tools?: string;
  /** The agent's role (`prompt` in the config). */
  prompt?: string;
}): string {
  const parts = [AGENT_INSTRUCTIONS];
  if (channel) parts.push(`# This chat\n\n${channel}`);
  if (tools) parts.push(`# Tools\n\n${tools}`);
  if (prompt) parts.push(`# Your role\n\n${prompt}`);
  return parts.join("\n\n");
}
