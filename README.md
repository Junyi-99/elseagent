# elseagents

A Codex agent integrated with Slack, built on [Bun](https://bun.com), [`@openai/codex-sdk`](https://www.npmjs.com/package/@openai/codex-sdk) and [`@slack/bolt`](https://slack.dev/bolt-js).

## Usage

```bash
# Generate a config template (default: ./config.yaml)
elseagents init
elseagents init -o /etc/elseagents/config.yaml --force

# Start the agent (reads /etc/elseagents/config.yaml by default)
elseagents
elseagents -c ./config.yaml
```

From source, replace `elseagents` with `bun src/index.ts`.

## Build & distribute

```bash
bun run build                                   # dist/elseagents for the current platform
bun run build -- --target=bun-linux-x64         # cross-compile, e.g. for a Linux server
```

The output is a single self-contained executable. It does **not** include the `codex` CLI
(a ~380 MB native binary per platform), so the target machine needs `codex` installed
(e.g. `npm i -g @openai/codex`), either on `PATH` or referenced by `codex.path` in the config.

## Development

| Command             | Description                                  |
| ------------------- | -------------------------------------------- |
| `bun install`       | Install dependencies                         |
| `bun run start`     | Run from source                              |
| `bun run build`     | Compile to a single executable               |
| `bun run typecheck` | Type check (`bun check`)                     |
| `bun run lint`      | Biome lint + format, applying fixes in place |
| `bun test`          | Run tests                                    |
