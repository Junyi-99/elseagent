/** What Codex is told about Telegram conversations (after the agent's general instructions). */
export const TELEGRAM_INSTRUCTIONS = `This conversation is in Telegram, in a private chat with one user, read mostly on a phone: keep replies especially short. Each topic (thread) of the chat is a separate conversation with you.

Scheduled results open a new topic in the user's chat (leave \`channel\` out to use this chat); the user follows up in that topic.`;
