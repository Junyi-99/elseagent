# Docker and Kubernetes

One [`Dockerfile`](../Dockerfile), two images. The container is the agent's sandbox: Codex runs
its commands inside it with full access, so the agent can use the network, install packages and
write anywhere in the container, but nothing outside it.

| Image  | Build                                            | Contains                                                                                                                         |
| ------ | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| `base` | `docker build --target base -t elseagent:base .` | Command-line tools: git/GitHub, C/C++, Python + uv, Go, Node.js, Bun, kubectl/Helm, Cloudflare CLIs, ImageMagick, ffmpeg, yt-dlp |
| `full` | `docker build --target full -t elseagent:full .` | `base` + Chromium (Playwright), LibreOffice, pandoc, PDF tools, CJK/emoji fonts, Python/Node libraries for Office files and PDFs |

Both build for `linux/amd64` and `linux/arm64` (`docker buildx build --platform ...`); sizes are
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
default command reads it), turn off Codex's own sandbox, and put credentials under `env:`
(see [config.md](config.md#env)):

```yaml
codex:
  sandboxMode: danger-full-access

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
a saved login (`codex login`, stored in `/home/agent/.codex`); if there is none it starts Codex's
device-code login before connecting to Slack or Telegram and prints the link and a one-time code to the
log (`docker logs` / `kubectl logs`). Open the link, enter the code, and the agent continues;
an expired code (15 minutes) is replaced with a new one. The login is saved in the home volume,
so this happens once.

The images run in Singapore time (`TZ=Asia/Singapore`), which is also the default for scheduled
tasks; change it with `agent.timezone` in the config, or `-e TZ=...` for the whole container.

## Volumes

| Path          | Holds                                                                                                                                                      | Persist? |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `/home/agent` | Codex sessions (`~/.codex`, needed to continue conversations), elseagent's state database (`~/.elseagent`), caches, tools the agent installed for its user | Yes      |
| `/workspace`  | The working directory: repositories and files the agent works on                                                                                           | Yes      |

Packages installed with `sudo apt-get` go to the image's system directories and are gone when
the container is recreated. Add tools the agent needs permanently to the Dockerfile.

## Docker

```bash
docker build --target full -t elseagent:full .
docker run -d --name reviewer --restart unless-stopped --shm-size=1g \
  -v "$PWD/reviewer.yaml:/etc/elseagent/config.yaml:ro" \
  -v reviewer-home:/home/agent \
  -v reviewer-workspace:/workspace \
  elseagent:full
```

Check a config without connecting to Slack or Telegram:
`docker run --rm -v "$PWD/reviewer.yaml:/etc/elseagent/config.yaml:ro" elseagent:full run -c /etc/elseagent/config.yaml --dry-run /workspace`.

## Kubernetes

Run each agent as its own **StatefulSet with one replica**. The state is a SQLite file, Slack
Socket Mode expects one connection per app and Telegram allows one poller per bot, so two pods of the same agent must never run at
once. A StatefulSet guarantees that: it only starts a replacement pod after the old one is gone,
even when a node becomes unreachable (a Deployment may start a second pod in that case). Its
volume claim template also gives the pod the same disk across restarts, and keeps the disk when
the StatefulSet is deleted. The pod is always named `<name>-0` (`kubectl logs reviewer-0`, e.g.
to read the Codex login code).

```yaml
apiVersion: v1
kind: Secret
metadata: { name: reviewer }
stringData:
  config.yaml: |
    codex:
      sandboxMode: danger-full-access
    channels:
      slack:
        botToken: xoxb-...
        appToken: xapp-...
    env:
      GH_TOKEN: ghp_...
---
# Required by the StatefulSet (serviceName); the agent serves nothing over the network.
apiVersion: v1
kind: Service
metadata: { name: reviewer }
spec:
  clusterIP: None
  selector: { app: reviewer }
---
apiVersion: apps/v1
kind: StatefulSet
metadata: { name: reviewer }
spec:
  serviceName: reviewer
  replicas: 1
  selector: { matchLabels: { app: reviewer } }
  template:
    metadata: { labels: { app: reviewer } }
    spec:
      securityContext: { fsGroup: 1000 }
      terminationGracePeriodSeconds: 60 # lets running turns tell their threads before stopping
      containers:
        - name: elseagent
          image: registry.example.com/elseagent:full
          volumeMounts:
            - { name: config, mountPath: /etc/elseagent, readOnly: true }
            - { name: data, mountPath: /home/agent, subPath: home }
            - { name: data, mountPath: /workspace, subPath: workspace }
            - { name: shm, mountPath: /dev/shm } # Chromium needs more than the default 64 MB
          resources:
            requests: { cpu: "1", memory: 2Gi }
            limits: { memory: 8Gi }
      volumes:
        - name: config
          secret: { secretName: reviewer }
        - name: shm
          emptyDir: { medium: Memory, sizeLimit: 1Gi }
  volumeClaimTemplates:
    - metadata: { name: data }
      spec:
        accessModes: [ReadWriteOnce]
        resources: { requests: { storage: 50Gi } }
```

The volume mounted on `/home/agent` starts empty and hides the image's (empty) home directory;
that is fine, the agent creates what it needs. For several agents, repeat the three objects with
a different name and config.
