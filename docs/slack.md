# Slack

Each agent is its own Slack app, so it has its own name, avatar and tokens. The name lives in
Slack, not in the config.

## Setup

1. https://api.slack.com/apps > **Create New App** > **From a manifest**, paste
   [`slack-app-manifest.yaml`](../slack-app-manifest.yaml) and change both names to the agent's
   name.
2. **Install to Workspace**, then copy the **Bot User OAuth Token** (`xoxb-`) into
   `channels.slack.botToken`.
3. **Basic Information > App-Level Tokens**: create a token with `connections:write`, copy it
   (`xapp-`) into `channels.slack.appToken`. Leave token rotation off: elseagent does not
   refresh it.
4. Optionally list public channels under `channels.slack.join`; the agent joins them at startup.
   Private channels need an `/invite @agent`.
5. Optionally set the app icon under **Basic Information > Display Information**, e.g.
   [`assets/avatar.png`](../assets/avatar.png) (1024 px; source:
   [`assets/avatar.svg`](../assets/avatar.svg)).

```yaml
channels:
  slack:
    botToken: xoxb-...
    appToken: xapp-...
    join: [ops]
```

All options: [config.md](config.md#channelsslack).

## In Slack

- The agent replies to `@mentions` in channels, in a thread, and to DMs.
- Each thread (or a DM's top level) is one conversation with its own Codex session.
- In channels the agent only acts when `@`-mentioned, but it reads the whole thread: each turn
  includes the messages posted since its last reply (the whole thread for a new session).
- Reactions on your message: ⏳ queued, 👀 working (removed when the reply is posted), ❌ failed.
- While Codex works, the bottom of the thread shows what it is doing ("is running `bun test`…").
- In a DM, the `/new` slash command starts the DM over with a new session. In channels, start a
  new thread instead.
- Scheduled tasks post their result as a new message in a channel; `@`-mention the agent in its
  thread to follow up.

See [usage.md](usage.md) for what works the same on every channel.
