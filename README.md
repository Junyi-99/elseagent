# elseagents

A Codex agent integrated with Slack, built on [Bun](https://bun.com), [`@openai/codex-sdk`](https://www.npmjs.com/package/@openai/codex-sdk) and [`@slack/bolt`](https://slack.dev/bolt-js).

## Setup

```bash
bun install
cp .env.example .env   # then fill in tokens
```

## Scripts

| Command             | Description                        |
| ------------------- | ---------------------------------- |
| `bun run dev`       | Run with file watching             |
| `bun run start`     | Run once                           |
| `bun run typecheck` | Type check (`bun check`)           |
| `bun run check`     | Biome lint + format + import check |
| `bun run check:fix` | Apply Biome fixes and formatting   |
| `bun test`          | Run tests                          |
