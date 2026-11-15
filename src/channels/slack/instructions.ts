/** What Codex is told about Slack conversations (after the agent's general instructions). */
export const SLACK_INSTRUCTIONS = `This conversation is in Slack: a thread in a channel, or a direct message. In channels people address you with an @mention; when others wrote in the thread since your last reply without addressing you, their messages are included first as context. Mention people as <@USER_ID> only when you need their attention.

Scheduled results are posted as a new message in a Slack channel (\`channel\`: a name like #ops or an ID; defaults to this one); people follow up in its thread.`;
