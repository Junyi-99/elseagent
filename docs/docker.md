# Docker and Kubernetes

One [`Dockerfile`](../Dockerfile), two images. The container is the agent's sandbox: Codex runs
its commands inside it with full access, so the agent can use the network, install packages and
write anywhere in the container, but nothing outside it.

| Image  | Published                                 | Contains                                                                                                                         |
| ------ | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `base` | `ghcr.io/elsescape/elseagent-base:latest` | Command-line tools: git/GitHub, C/C++, Python + uv, Go, Node.js, Bun, kubectl/Helm, Cloudflare CLIs, ImageMagick, ffmpeg, yt-dlp |
| `full` | `ghcr.io/elsescape/elseagent-full:latest` | `base` + Chromium (Playwright), LibreOffice, pandoc, PDF tools, CJK/emoji fonts, Python/Node libraries for Office files and PDFs |

The [`images` workflow](../.github/workflows/images.yml) builds both for `linux/amd64` and
`linux/arm64` on every push to `main` and publishes them as `latest`; older versions are deleted,
so `latest` is the only one. The images are public: no login needed. To build
locally instead: `docker build --target full -t elseagent:full .` (or `--target base`). Sizes are
about 4.2 GB (`base`) and 6.5 GB (`full`). Tool versions are pinned as `ARG`s at the top of the
`base` stage (Node is the current LTS); the browser is Playwright's headless Chromium.

## What each section is for

| Need                                    | Tools                                                                                                                                                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Basics                                  | `curl`, `wget`, `aria2c`, `jq`, `yq`, `rg`, `fd`, `zip`/`unzip`/`7z`, `tmux`, `bc`, `envsubst`, `shellcheck`, `lsof`, `strace`, `sqlite3`, `ssh`, `sudo`                                                              |
| 1. GitHub                               | `git`, `git-lfs`, `gh`; with `GH_TOKEN` set, `git` over HTTPS is authenticated through `gh`                                                                                                                           |
| 2. Code and dependencies                | `gcc`/`g++`, `cmake`, `ninja`, `gdb`; `python3`, `uv`; `go`; `node`, `npm`, `pnpm`/`yarn` (corepack), `bun`                                                                                                           |
| 3. Cloud                                | `kubectl`, `helm`, `wrangler`, `cloudflared`                                                                                                                                                                          |
| 4. Images                               | ImageMagick (`magick`), `rsvg-convert`, `cwebp`, `optipng`, `jpegoptim`, `exiftool`, Pillow                                                                                                                           |
| 5. Video                                | `yt-dlp` (YouTube, Bilibili, …) with Node as its JavaScript runtime, `ffmpeg`; `full` adds a browser                                                                                                                  |
| 6. Office, websites, marketing (`full`) | LibreOffice (headless), `pandoc`, Playwright Chromium (HTML → PNG/PDF), fonts; Python: python-docx, python-pptx, openpyxl, xlsxwriter, pandas, matplotlib, reportlab, weasyprint, pypdf; Node: pptxgenjs, docx; `zip` |
| 7. Anything else                        | passwordless `sudo apt-get install`, `uv pip install` / `uv tool install`, `npm i -g`, `go install`, `bun add -g`                                                                                                     |

Python libraries live in the `/opt/tools` virtualenv, which is first on `PATH`, so plain
`python` scripts can import them. Global Node packages resolve through `NODE_PATH`.

## Configuration in a container

Everything an agent needs is in one file. Mount it at `/etc/elseagent/config.yaml` (the image's
default command reads it) and put credentials under `env:` (see [config.md](config.md#env)).
Codex's own sandbox is off in the images (`ELSEAGENT_SANDBOX_MODE=danger-full-access`): the
container is the sandbox.

```yaml
channels:
  slack:
    botToken: xoxb-...
    appToken: xapp-...

env:
  CODEX_API_KEY: sk-... # Codex; optional, see below
  GH_TOKEN: ghp_... # gh and git on github.com
  CLOUDFLARE_API_TOKEN: ... # wrangler
  CLOUDFLARE_ACCOUNT_ID: ...
  KUBECONFIG: /etc/elseagent/kubeconfig # kubectl/helm; in-cluster a ServiceAccount also works
```

**Codex sign-in.** With `CODEX_API_KEY`, Codex uses the key. Without it, elseagent checks for
a saved login (`codex login`, stored in `/home/elseagent/.codex`); if there is none it starts Codex's
device-code login before connecting to Slack or Telegram and prints the link and a one-time code to the
log (`docker logs` / `kubectl logs`). Open the link, enter the code, and the agent continues;
an expired code (15 minutes) is replaced with a new one. The login is saved in the home volume,
so this happens once.

The images run in Singapore time (`TZ=Asia/Singapore`), which is also the default for scheduled
tasks; change it with `timezone` in the config, or `-e TZ=...` for the whole container.

## Volume

The agent runs as the user `elseagent` and keeps everything in its home, so one volume on
`/home/elseagent` is enough:

| Path                         | Holds                                                                      |
| ---------------------------- | -------------------------------------------------------------------------- |
| `~/workspace`                | The workspace: repositories and files the agent works on                   |
| `~/.codex`                   | Codex login and sessions (needed to continue conversations)                |
| `~/.elseagent`               | elseagent's state database (session mapping, queue, schedules)             |
| `~/.npm-global`, `~/go`, ... | Tools the agent installed for its user (`npm i -g`, `go install`, uv, Bun) |

To keep the workspace on its own volume, mount it anywhere and set `workspace` in the config,
e.g. `workspace: /workspace` with `-v agent-workspace:/workspace`.

A new, empty Docker named volume is filled with the image's home directory on first use
(`.bashrc`, `.profile`, the empty `workspace`). A bind mount or a Kubernetes volume starts empty
instead, which is fine: the PATH comes from the image (`/etc/profile.d`), and elseagent creates
the workspace and its other directories. Shell history (`.bash_history`) is only written by
interactive shells, e.g. when you `docker exec -it ... bash`; Codex's commands don't add to it.

Packages installed with `sudo apt-get` go to the image's system directories and are gone when
the container is recreated. Add tools the agent needs permanently to the Dockerfile.

## Docker

```bash
docker run -d --name reviewer --restart unless-stopped --shm-size=1g \
  -v "$PWD/reviewer.yaml:/etc/elseagent/config.yaml:ro" \
  -v reviewer-home:/home/elseagent \
  ghcr.io/elsescape/elseagent-full:latest
```

Check a config without connecting to Slack or Telegram:
`docker run --rm -v "$PWD/reviewer.yaml:/etc/elseagent/config.yaml:ro" ghcr.io/elsescape/elseagent-full:latest run -c /etc/elseagent/config.yaml --dry-run`.

## Kubernetes

Run each agent as its own **StatefulSet with one replica**. The state is a SQLite file, Slack
Socket Mode expects one connection per app and Telegram allows one poller per bot, so two pods of the same agent must never run at
once. A StatefulSet guarantees that: it only starts a replacement pod after the old one is gone,
even when a node becomes unreachable (a Deployment may start a second pod in that case). Its
volume claim template also gives the pod the same disk across restarts, and keeps the disk when
the StatefulSet is deleted.

[`k8s/elseagent.yaml`](../k8s/elseagent.yaml) is a ready-to-use manifest: a Secret holding the
config (Slack tokens to fill in), a headless Service (required by the StatefulSet; the agent serves
nothing over the network) and the StatefulSet: the `full` image, a 32 GB volume on
`/home/elseagent`, 4 GB of memory, and a memory-backed `/dev/shm` for Chromium.

```bash
kubectl apply -f k8s/elseagent.yaml
kubectl logs -f elseagent-0                        # first start: sign in to Codex
kubectl rollout restart statefulset/elseagent      # after changing the Secret, or to pull `latest`
```

The pod is always named `<name>-0`. The volume starts empty (see [Volume](#volume)); that is
fine. For another agent, copy the file and replace `elseagent` with its name.
