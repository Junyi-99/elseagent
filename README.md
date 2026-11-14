# elseagent

A Codex agent integrated with Slack, built on [Bun](https://bun.com), [`@openai/codex-sdk`](https://www.npmjs.com/package/@openai/codex-sdk) and [`@slack/bolt`](https://slack.dev/bolt-js).

## Usage

```bash
# Generate a minimal config (default: ./config.yaml)
elseagent init
elseagent init -o /etc/elseagent/config.yaml --force

# Start the agent: elseagent run [-c config] [working-directory]
elseagent run                                  # /etc/elseagent/config.yaml, works in the current directory
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

## Build & distribute

```bash
bun run build                                   # dist/elseagent for the current platform
bun run build -- --target=bun-linux-x64         # cross-compile, e.g. for a Linux server
```

The output is a single self-contained executable. It does **not** include the `codex` CLI
(a ~380 MB native binary per platform), so the target machine needs `codex` installed
(e.g. `npm i -g @openai/codex`), either on `PATH` or referenced by `codex.path` in the config.

## Development

| Command             | Description                                  |
| ------------------- | -------------------------------------------- |
| `bun install`       | Install dependencies                         |
| `bun run start`     | Run locally during development               |
| `bun run build`     | Compile to a single executable               |
| `bun run typecheck` | Type check (`bun check`)                     |
| `bun run lint`      | Biome lint + format, applying fixes in place |
| `bun test`          | Run tests                                    |
