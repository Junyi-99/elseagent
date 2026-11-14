# elseagent

A Codex agent integrated with Slack, built on [Bun](https://bun.com), [`@openai/codex-sdk`](https://www.npmjs.com/package/@openai/codex-sdk) and [`@slack/bolt`](https://slack.dev/bolt-js).

## Usage

```bash
# Generate a minimal config (default: ~/.elseagent.yaml)
elseagent init
elseagent init -o ./agents/reviewer.yaml --force

# Start the agent: elseagent run [-c config] [working-directory]
elseagent run                                  # ~/.elseagent.yaml, works in the current directory
elseagent run -c ./config.yaml /srv/workspace  # custom config and working directory
elseagent run -c ./config.yaml --dry-run       # validate config, codex and working directory, then exit
```

Codex runs in agent mode: `workspace-write` sandbox, no approval prompts, allowed outside git
repos. Only `model` and `reasoningEffort` can be overridden; everything else uses the Codex defaults.

## Configuration

`elseagent init` writes [`config.example.yaml`](config.example.yaml): only the required Slack
tokens, as placeholders to replace. Every other option is optional and documented, with its
default, in [`docs/config.md`](docs/config.md).

When adding an option, add it to [`src/config/schema.ts`](src/config/schema.ts) and document it in
`docs/config.md` (a test fails if an option is undocumented).

## Slack setup (one app per agent)

Each agent is its own Slack app, so it has its own name, avatar and tokens. The name lives in
Slack, not in `config.yaml`.

1. https://api.slack.com/apps > **Create New App** > **From a manifest**, paste
   [`slack-app-manifest.yaml`](slack-app-manifest.yaml) and change both names to the agent's name.
2. **Install to Workspace**, then copy the **Bot User OAuth Token** (`xoxb-`) into `slack.botToken`.
3. **Basic Information > App-Level Tokens**: create a token with `connections:write`, copy it
   (`xapp-`) into `slack.appToken`.
4. Optionally list public channels under `slack.channels`; the agent joins them at startup.
   Private channels need an `/invite @agent`.

The agent replies to `@mentions` in channels (in a thread) and to DMs.

## How messages are handled

- Each Slack thread (or a DM's top level) is one conversation, mapped to one Codex session.
  Follow-ups in the thread continue that session; Codex keeps the history.
- In channels the agent only acts when `@`-mentioned, but it reads the whole thread: each turn
  includes the messages posted since its last reply (the whole thread for a new session).
- Codex gets built-in instructions for working in Slack (ask instead of guessing, end the turn
  to wait for an answer, Slack-friendly Markdown); `agent.prompt` is added after them.
- When Codex needs a decision it can offer choices, shown as buttons. Clicking one records the
  pick on the message and sends it to the agent as the next message.
- At most `agent.maxConcurrent` Codex turns run at once. Further messages wait in a queue
  (first come, first served, one turn at a time per conversation), shown with ⏳.
  👀 means working, ✅ done, ❌ failed or timed out.
- While Codex works, the thread shows what it is doing at the bottom ("is running `bun test`…",
  "is editing app.ts…"), using Slack's loading status. It disappears when the reply is posted.
- The session mapping and the queue live in SQLite under `agent.stateDir`, so queued messages
  survive a restart. Messages that were mid-turn during a restart are reported back, not rerun.
- Conversations idle for `agent.sessionIdleDays` are forgotten; their next message starts fresh.

## Agent tools and scheduled tasks

elseagent serves its own MCP tools (on `127.0.0.1`, random port and token) and registers them with
every Codex turn automatically, so the agent can inspect and manage itself when asked:

- `status`, `list_queue`, `list_sessions`: running turns, queued messages, sessions, limits.
- `cancel_turn`, `remove_queued`, `forget_session`: stop a running turn (its thread is told who
  stopped it), drop a queued message, or start a conversation over.
- `schedule_create`, `schedule_list`, `schedule_delete`, `schedule_run_now`: recurring tasks.

Ask in plain words, e.g. "every weekday at 9am, check the CI dashboard and post a summary in
#ops". Each run starts a new Codex session and posts its result as a new message in the channel;
`@`-mention the agent in that message's thread to follow up on that run. Schedules use
`agent.timezone` unless they set their own, run at most every 5 minutes, and are limited to 50
per agent. A run missed while the agent was down happens once after it restarts. Public
channels are joined automatically; private ones need an `/invite` first.

Anyone who can mention the agent can use these tools.

## Build & distribute

```bash
bun run build                                   # dist/elseagent for the current platform
bun run build -- --target=bun-linux-x64         # cross-compile, e.g. for a Linux server
```

The output is a single self-contained executable. It does **not** include the `codex` CLI
(a ~380 MB native binary per platform), so the target machine needs `codex` installed
(e.g. `npm i -g @openai/codex`), either on `PATH` or referenced by `codex.path` in the config.

## Development

| Command               | Description                                                                                                                |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `bun install`         | Install dependencies                                                                                                       |
| `bun run start`       | Run locally during development                                                                                             |
| `bun run build`       | Compile to a single executable                                                                                             |
| `bun run typecheck`   | Type check (`bun check`)                                                                                                   |
| `bun run lint`        | Biome lint + format, applying fixes in place                                                                               |
| `bun test`            | Run tests                                                                                                                  |
| `bun run db:generate` | After changing `src/state/schema.ts`: generate a Drizzle migration into `drizzle/` (embedded into the build automatically) |
