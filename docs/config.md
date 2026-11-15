# Configuration

elseagent reads a YAML file, `~/.elseagent.yaml` by default (`elseagent run -c <path>`
to use another). `elseagent init` writes a minimal one with only the required settings, the
same as [`config.example.yaml`](../config.example.yaml).

Every option below is optional unless marked **required**. Leave out what you don't need; omitted
options use their default. A missing or empty section behaves like an empty one.

`channels` is where people talk to the agent: `channels.slack`, `channels.telegram`, or both
(one agent then answers on both, sharing its queue and limits). Each is turned on by its
section; at least one is needed.

```yaml
agent:
  prompt: |
    You are the on-call assistant for the payments team.
    Keep replies short; link to files you changed.
  maxConcurrent: 8

codex:
  model: <model-name>
  reasoningEffort: high

channels:
  slack:
    botToken: xoxb-...
    appToken: xapp-...
    join:
      - payments-oncall
  telegram:
    botToken: "123456789:AA..."
    allowedUsers: [123456789]
```

The working directory is not part of the config: pass it on the command line
(`elseagent run -c <config> [working-directory]`, default: the current directory).

## `agent`

How this agent behaves and how much work it takes on at once.

| Option                     | Type    | Default          | Description                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | ------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent.prompt`             | string  | none             | The agent's role, given to Codex as developer instructions in every conversation, on top of Codex's own instructions. Without it, each conversation is a plain Codex session. Use `\|` for multi-line text.                                                                                                                                                                                              |
| `agent.maxConcurrent`      | integer | `32`             | Codex turns running at the same time. A turn is one reply to one message, run as one `codex exec` process; idle conversations don't count. Further messages wait in a queue, first come first served.                                                                                                                                                                                                    |
| `agent.maxQueue`           | integer | `1024`           | Messages that may wait for a free slot. The queue is stored in SQLite, so it survives restarts and can be large. Beyond this the agent replies that it is busy.                                                                                                                                                                                                                                          |
| `agent.turnTimeoutMinutes` | integer | `30`             | A turn running longer than this is stopped, freeing its slot, and the thread is told it timed out. The conversation keeps its context. Guards against stuck commands or loops.                                                                                                                                                                                                                           |
| `agent.sessionIdleDays`    | integer | `7`              | A conversation (Slack thread or DM, Telegram topic) with no activity for this long is forgotten; its next message starts a new Codex session.                                                                                                                                                                                                                                                            |
| `agent.stateDir`           | string  | `~/.elseagent`   | Where the agent keeps its SQLite database: which Codex session each conversation uses, and the queue of unanswered messages. Message history is not stored there (Codex keeps it). One file per agent, named after its bot (`<team>-<bot user>.sqlite` with Slack, else `telegram-<bot id>.sqlite`), so agents can share the directory. `~` is expanded; relative paths resolve against the config file. |
| `agent.timezone`           | string  | server time zone | Default time zone for scheduled tasks, as an IANA name (e.g. `Asia/Shanghai`). A task can also set its own when created ("every day at 9 Beijing time").                                                                                                                                                                                                                                                 |

## `codex`

Codex always runs in agent mode: no approval prompts, allowed outside git repositories, and the
`workspace-write` sandbox unless `codex.sandboxMode` says otherwise. Everything not listed here uses the Codex defaults, including authentication
(`CODEX_API_KEY` in `env:`, a saved `codex login`, or a device-code login started at launch).

| Option                  | Type   | Default           | Description                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------- | ------ | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `codex.path`            | string | `codex` on `PATH` | The codex CLI binary: an absolute path, a path relative to the config file, or a command name looked up on `PATH`. The elseagent executable does not include codex; install it separately (e.g. `npm i -g @openai/codex`).                                                                                                                                                                        |
| `codex.model`           | string | Codex default     | Force a model for every conversation.                                                                                                                                                                                                                                                                                                                                                             |
| `codex.reasoningEffort` | string | Codex default     | Force the reasoning effort: `minimal`, `low`, `medium`, `high`, `xhigh`, `max`, `ultra` or `persistent`.                                                                                                                                                                                                                                                                                          |
| `codex.sandboxMode`     | string | `workspace-write` | `workspace-write`: Codex's own sandbox lets commands write only in the working directory, without network. `danger-full-access`: no Codex sandbox, so the agent can use the network, install packages and write anywhere. Use it in Docker/Kubernetes, where the container is the sandbox (see [docker.md](docker.md)); Codex's sandbox often cannot start inside unprivileged containers anyway. |

## `channels.slack`

Each agent is its own Slack app, so its name and avatar are set in Slack, not here. See
[Slack setup](slack.md).

| Option                    | Type            | Default      | Description                                                                                                                                                                                                  |
| ------------------------- | --------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `channels.slack.botToken` | string          | **required** | Bot User OAuth Token (`xoxb-...`), from **OAuth & Permissions** after installing the app.                                                                                                                    |
| `channels.slack.appToken` | string          | **required** | App-level token with the `connections:write` scope (`xapp-...`), from **Basic Information > App-Level Tokens**. Used for Socket Mode.                                                                        |
| `channels.slack.join`     | list of strings | none         | Public Slack channels to join at startup, by name (`general` or `#general`) or ID (`C0123456789`). Channels that can't be found or joined are logged and skipped. Private channels need an `/invite @agent`. |

## `channels.telegram`

A Telegram bot that talks to its users in private chats. Create it with
[@BotFather](https://t.me/BotFather) and turn on its threaded mode there, so each topic of a chat
is its own conversation; see [Telegram setup](telegram.md).

| Option                           | Type            | Default      | Description                                                                                                                                                                                                                           |
| -------------------------------- | --------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `channels.telegram.botToken`     | string          | **required** | The bot token from @BotFather (`123456789:AA...`). Quote it in YAML.                                                                                                                                                                  |
| `channels.telegram.allowedUsers` | list of numbers | none         | Telegram user IDs allowed to use the agent. Anyone else gets a refusal with their ID. Send `/start` to the bot to see your ID, add it here and restart the agent. Empty means nobody can use it yet. Groups and channels are ignored. |

## `env`

Environment variables for the agent, so one config file holds everything: credentials and
settings for Codex and the tools it uses. Every variable listed here is available to elseagent,
to Codex, and to every command Codex runs (`gh`, `git`, `wrangler`, `kubectl`…).

They are handed to Codex's commands explicitly (Codex's `shell_environment_policy.set`), so
they reach `gh`, `wrangler` and the rest regardless of Codex's own environment filtering.
Values are strings; numbers and booleans are converted.

```yaml
env:
  CODEX_API_KEY: sk-... # Codex; without it: a saved `codex login`, else a device code is logged
  GH_TOKEN: ghp_... # gh and git on github.com
  CLOUDFLARE_API_TOKEN: ... # wrangler
  CLOUDFLARE_ACCOUNT_ID: ...
  KUBECONFIG: /etc/elseagent/kubeconfig # kubectl/helm (a mounted file)
```

The config file then contains secrets: keep it readable only by the agent (in Kubernetes, store
it as a Secret).
