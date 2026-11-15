# Telegram

The agent talks to its users in private chats with a Telegram bot. With threaded mode on, each
topic of a chat is its own conversation.

## Setup

1. In Telegram, talk to [@BotFather](https://t.me/BotFather): `/newbot`, pick a name and
   username, and copy the token into `channels.telegram.botToken`.
2. In @BotFather, open the bot's settings and turn on **threaded mode** (topics in private
   chats).
3. Start the agent, open a chat with the bot and send `/start`: it replies with your user ID.
   Add it to `channels.telegram.allowedUsers` and restart the agent.

```yaml
channels:
  telegram:
    botToken: "123456789:AA..."
    allowedUsers: [123456789]
```

All options: [config.md](config.md#channelstelegram).

## In Telegram

- Only users in `allowedUsers` can talk to the agent; anyone else gets a refusal with their user
  ID. Groups are ignored.
- Each topic is one conversation with its own Codex session (keyed by your chat and the topic).
  Start a new topic for something new; `/new` starts the current one over. Without threaded mode
  the whole chat is one conversation.
- Reactions on your message: 🫡 queued, 👀 working, 😢 failed (Telegram only allows some emoji).
- While Codex works, a draft message shows what it is doing ("Running `bun test`…").
- Choices appear as buttons under the reply; your pick is sent as your next message.
- Scheduled tasks open a new topic in your chat for each run; reply there to follow up.
- Send photos, documents, videos, audio or voice notes, with a caption or without; an album
  arrives as one message. Stickers, locations and the like are not read.

See [usage.md](usage.md) for what works the same on every channel.
