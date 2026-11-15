<p align="center"><img src="assets/avatar.png" alt="elseagent" width="160"></p>

# elseagent

A [Codex](https://github.com/openai/codex) agent you chat with in Slack or Telegram. It writes
code, runs commands and can do tasks on a schedule.

## Quick start

**1. Create a bot**: [Telegram](docs/telegram.md) (2 minutes) or [Slack](docs/slack.md).

**2. Write `config.yaml`**:

```yaml
channels:
  telegram:
    botToken: "123456789:AA..."
    allowedUsers: [] # your user ID goes here, see step 4

codex:
  sandboxMode: danger-full-access # the container is the sandbox
```

**3. Run it**:

```bash
docker build --target full -t elseagent .
docker run -d --name elseagent --shm-size=1g \
  -v "$PWD/config.yaml:/etc/elseagent/config.yaml:ro" \
  -v elseagent-home:/home/agent -v elseagent-workspace:/workspace \
  elseagent
docker logs -f elseagent   # first time: open the link, enter the code to sign in to Codex
```

**4. Allow yourself**: send `/start` to the bot, put the user ID it replies with into
`allowedUsers`, then `docker restart elseagent`. Now message your bot.

## More

- [Configuration](docs/config.md): every option (Slack, the agent's role, limits, `env` for credentials)
- [Usage](docs/usage.md): conversations, agent tools, scheduled tasks, running without Docker
- [Docker and Kubernetes](docs/docker.md)
- [Development](docs/development.md)
