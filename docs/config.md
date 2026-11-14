# Configuration

elseagent reads a YAML file, `~/.elseagent.yaml` by default (`elseagent run -c <path>`
to use another). `elseagent init` writes a minimal one with only the required settings, the
same as [`config.example.yaml`](../config.example.yaml).

Every option below is optional unless marked **required**. Leave out what you don't need; omitted
options use their default. A missing or empty section behaves like an empty one.

```yaml
agent:
  prompt: |
    You are the on-call assistant for the payments team.
    Keep replies short; link to files you changed.
  maxConcurrent: 8

codex:
  model: <model-name>
  reasoningEffort: high

slack:
  botToken: xoxb-...
  appToken: xapp-...
  channels:
    - payments-oncall
```

The working directory is not part of the config: pass it on the command line
(`elseagent run -c <config> [working-directory]`, default: the current directory).

## `agent`

How this agent behaves and how much work it takes on at once.

| Option                     | Type    | Default          | Description                                                                                                                                                                                                                                                                                                                                 |
| -------------------------- | ------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent.prompt`             | string  | none             | The agent's role, given to Codex as developer instructions in every conversation, on top of Codex's own instructions. Without it, each conversation is a plain Codex session. Use `\|` for multi-line text.                                                                                                                                 |
| `agent.maxConcurrent`      | integer | `16`             | Codex turns running at the same time. A turn is one reply to one message, run as one `codex exec` process; idle conversations don't count. Further messages wait in a queue, first come first served.                                                                                                                                       |
| `agent.maxQueue`           | integer | `1024`           | Messages that may wait for a free slot. The queue is stored in SQLite, so it survives restarts and can be large. Beyond this the agent replies that it is busy.                                                                                                                                                                             |
| `agent.turnTimeoutMinutes` | integer | `30`             | A turn running longer than this is stopped, freeing its slot, and the thread is told it timed out. The conversation keeps its context. Guards against stuck commands or loops.                                                                                                                                                              |
| `agent.sessionIdleDays`    | integer | `7`              | A conversation (Slack thread or DM) with no activity for this long is forgotten; its next message starts a new Codex session.                                                                                                                                                                                                               |
| `agent.stateDir`           | string  | `~/.elseagent`   | Where the agent keeps its SQLite database: which Codex session each Slack thread uses, and the queue of unanswered messages. Message history is not stored there (Codex keeps it). One file per Slack bot (`<team>-<bot user>.sqlite`), so agents can share the directory. `~` is expanded; relative paths resolve against the config file. |
| `agent.timezone`           | string  | server time zone | Default time zone for scheduled tasks, as an IANA name (e.g. `Asia/Shanghai`). A task can also set its own when created ("every day at 9 Beijing time").                                                                                                                                                                                    |

## `codex`

Codex always runs in agent mode: `workspace-write` sandbox, no approval prompts, allowed outside
git repositories. Everything not listed here uses the Codex defaults, including authentication
(`codex login` or the `CODEX_API_KEY` environment variable).

| Option                  | Type   | Default           | Description                                                                                                                                                                                                                |
| ----------------------- | ------ | ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex.path`            | string | `codex` on `PATH` | The codex CLI binary: an absolute path, a path relative to the config file, or a command name looked up on `PATH`. The elseagent executable does not include codex; install it separately (e.g. `npm i -g @openai/codex`). |
| `codex.model`           | string | Codex default     | Force a model for every conversation.                                                                                                                                                                                      |
| `codex.reasoningEffort` | string | Codex default     | Force the reasoning effort: `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra` or `persistent`.                                                                                                                   |

## `slack`

Each agent is its own Slack app, so its name and avatar are set in Slack, not here. See
[Slack setup](../README.md#slack-setup-one-app-per-agent).

| Option           | Type            | Default      | Description                                                                                                                                                                                            |
| ---------------- | --------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `slack.botToken` | string          | **required** | Bot User OAuth Token (`xoxb-...`), from **OAuth & Permissions** after installing the app.                                                                                                              |
| `slack.appToken` | string          | **required** | App-level token with the `connections:write` scope (`xapp-...`), from **Basic Information > App-Level Tokens**. Used for Socket Mode.                                                                  |
| `slack.channels` | list of strings | none         | Public channels to join at startup, by name (`general` or `#general`) or ID (`C0123456789`). Channels that can't be found or joined are logged and skipped. Private channels need an `/invite @agent`. |
