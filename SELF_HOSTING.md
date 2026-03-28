# 🌍 Self-Hosting World Monitor

Run the full World Monitor stack locally with Docker/Podman.

## 📋 Prerequisites

- **Docker** or **Podman** (rootless works fine)
- **Docker Compose** or **podman-compose** (`pip install podman-compose` or `uvx podman-compose`)
- **Node.js 24 recommended** for host-side scripts (`22` remains supported)

## 🚀 Quick Start

```bash
# 1. Clone and enter the repo
git clone https://github.com/koala73/worldmonitor.git
cd worldmonitor
npm install

# 2. Start the stack
docker compose up -d        # or: uvx podman-compose up -d

# 3. Seed data into Redis
./scripts/run-seeders.sh

# 4. Open the dashboard
open http://localhost:3000
```

The dashboard works out of the box with public data sources (earthquakes, weather, conflicts, etc.). API keys unlock additional data feeds.

For a full inventory of `user_local`, `instance_default`, and `instance_secret` settings, see [docs/SETTINGS_MANAGEMENT.md](/Users/jrmag/worldmonitor/docs/SETTINGS_MANAGEMENT.md).

## 🔑 API Keys

Create a `docker-compose.override.yml` to inject your keys. This file is **gitignored** — your secrets stay local. If you manage the stack in Portainer, start from [docker-compose.portainer.example.yml](/Users/jrmag/worldmonitor/docker-compose.portainer.example.yml) and paste the relevant environment section into the stack editor.

```yaml
services:
  worldmonitor:
    environment:
      # 🤖 LLM — pick one or both (used for intelligence assessments)
      GROQ_API_KEY: ""            # https://console.groq.com (free, 14.4K req/day)
      OPENROUTER_API_KEY: ""      # https://openrouter.ai (free, 50 req/day)

      # 📊 Markets & Economics
      FINNHUB_API_KEY: ""         # https://finnhub.io (free tier)
      FRED_API_KEY: ""            # https://fred.stlouisfed.org/docs/api/api_key.html (free)
      EIA_API_KEY: ""             # https://www.eia.gov/opendata/ (free)

      # ⚔️ Conflict & Unrest
      ACLED_ACCESS_TOKEN: ""      # https://acleddata.com (free for researchers)

      # 🛰️ Earth Observation
      NASA_FIRMS_API_KEY: ""      # https://firms.modaps.eosdis.nasa.gov (free)

      # ✈️ Aviation
      AVIATIONSTACK_API: ""       # https://aviationstack.com (free tier)

      # 🚢 Maritime
      AISSTREAM_API_KEY: ""       # https://aisstream.io (free)

      # 🌐 Internet Outages (paid)
      CLOUDFLARE_API_TOKEN: ""    # https://dash.cloudflare.com (requires Radar access)

      # 🔌 Self-hosted LLM (optional — any OpenAI-compatible endpoint)
      LLM_API_URL: ""             # e.g. http://localhost:11434/v1/chat/completions
      LLM_API_KEY: ""
      LLM_MODEL: ""

  ais-relay:
    environment:
      AISSTREAM_API_KEY: ""       # same key as above — relay needs it too
```

If you run on a VPS, prefer editing stack environment variables in Portainer instead of hand-editing Compose on disk. Runtime UX defaults such as theme, map provider, stream quality, and breaking-alert defaults can now be managed with the `WM_INSTANCE_*` variables documented in [.env.example](/Users/jrmag/worldmonitor/.env.example) and [docs/SETTINGS_MANAGEMENT.md](/Users/jrmag/worldmonitor/docs/SETTINGS_MANAGEMENT.md).

### 💰 Free vs Paid

| Status | Keys |
|--------|------|
| 🟢 No key needed | Earthquakes, weather, natural events, UNHCR displacement, prediction markets, stablecoins, crypto, spending, climate anomalies, submarine cables, BIS data, cyber threats |
| 🟢 Free signup | GROQ, FRED, EIA, NASA FIRMS, AISSTREAM, Finnhub, AviationStack, ACLED, OpenRouter |
| 🟡 Free (limited) | OpenSky (higher rate limits with account) |
| 🔴 Paid | Cloudflare Radar (internet outages) |

## 🌱 Seeding Data

The seed scripts fetch upstream data and write it to Redis. They run **on the host** (not inside the container) and need the Redis REST proxy to be running.

```bash
# Run all seeders (auto-sources API keys from docker-compose.override.yml)
./scripts/run-seeders.sh
```

**⚠️ Important:** Redis data persists across container restarts via the `redis-data` volume, but is lost on `docker compose down -v`. Re-run the seeders if you remove volumes or see stale data.

To automate, add a cron job:

```bash
# Re-seed every 30 minutes
*/30 * * * * cd /path/to/worldmonitor && ./scripts/run-seeders.sh >> /tmp/wm-seeders.log 2>&1
```

For 24/7 VPS operation, keep this cron job for seeders, but do not also schedule `scripts/discord-notify.mjs` from the host if the container is already running it under `supervisord`.

## 💬 Discord Guide Channels

If you run a Discord community, you can now publish pinned guide posts for each channel without adding a bot yet.

Recommended channels:

- `#welcome`
- `#how-to-use`
- `#commands`
- `#ops`
- `#alerts`

Set one webhook per channel in [.env.example](/Users/jrmag/worldmonitor/.env.example) or Portainer:

- `DISCORD_GUIDE_WEBHOOK_URL_DEFAULT`
- `DISCORD_GUIDE_WEBHOOK_URL_WELCOME`
- `DISCORD_GUIDE_WEBHOOK_URL_HOW_TO_USE`
- `DISCORD_GUIDE_WEBHOOK_URL_COMMANDS`
- `DISCORD_GUIDE_WEBHOOK_URL_OPS`
- `DISCORD_GUIDE_WEBHOOK_URL_ALERTS`

Then post the guides:

```bash
# Preview payloads without sending anything
npm run discord:guides:dry-run

# Post all guide messages
npm run discord:guides

# Post only one channel's guide
node scripts/discord-guide-posts.mjs --channel commands
```

Important:

- The guide poster itself is **webhook-only**.
- Slash commands are configured separately in the next section.
- `alerts` can reuse `DISCORD_WEBHOOK_URL` if you do not set a separate guide webhook for that channel.
- If you run the poster on the host, provide guide webhook values through shell env vars or `.env.local`. Portainer-managed env vars are available automatically only when you run the command inside the container or stack environment.

## 🤖 Discord Slash Commands

World Monitor can now answer basic Discord slash commands in self-hosted mode.

Supported commands:

- `/help`
- `/status`
- `/health`
- `/latest`

Required variables:

- `DISCORD_PUBLIC_KEY`
- `DISCORD_APPLICATION_ID`
- `DISCORD_BOT_TOKEN`

Optional:

- `DISCORD_GUILD_ID`
  Use this for faster command registration while testing in a single server.

Setup flow:

```bash
# 1. Put the bot variables into .env.local or Portainer env
# 2. Point Discord Interactions Endpoint URL at:
#    https://YOUR-DOMAIN/api/discord/interactions

# 3. Preview the registration payload
npm run discord:register:dry-run

# 4. Register commands globally
npm run discord:register

# 5. Or register to one guild while testing
node scripts/discord-register-commands.mjs --guild YOUR_GUILD_ID
```

Notes:

- The interaction endpoint verifies Discord Ed25519 signatures before it accepts a request.
- Responses are currently `ephemeral`, so only the user who ran the command sees them.
- `/latest` uses cached Redis data. If Redis is empty or seeders have not run yet, it returns a short fallback message instead of hanging.

### 🔧 Manual seeder invocation

If you prefer to run seeders individually:

```bash
export UPSTASH_REDIS_REST_URL=http://localhost:8079
export UPSTASH_REDIS_REST_TOKEN=wm-local-token
node scripts/seed-earthquakes.mjs
node scripts/seed-military-flights.mjs
# ... etc
```

## 🏗️ Architecture

```
┌─────────────────────────────────────────────┐
│                 localhost:3000               │
│                   (nginx)                    │
├──────────────┬──────────────────────────────┤
│ Static Files │      /api/* proxy            │
│  (Vite SPA)  │         │                    │
│              │    Node.js API (:46123)       │
│              │    50+ route handlers         │
│              │         │                     │
│              │    Redis REST proxy (:8079)   │
│              │         │                     │
│              │      Redis (:6379)            │
└──────────────┴──────────────────────────────┘
         AIS Relay (WebSocket → AISStream)
```

| Container | Purpose | Port |
|-----------|---------|------|
| `worldmonitor` | nginx + Node.js API (supervisord) | 3000 → 8080 |
| `worldmonitor-redis` | Data store | 6379 (internal) |
| `worldmonitor-redis-rest` | Upstash-compatible REST proxy | 8079 |
| `worldmonitor-ais-relay` | Live vessel tracking WebSocket | 3004 (internal) |

## 🔨 Building from Source

```bash
# Frontend only (for development)
npx vite build

# Full Docker image
docker build -t worldmonitor:latest -f Dockerfile .

# Rebuild and restart
docker compose down && docker compose up -d
./scripts/run-seeders.sh
```

### ⚠️ Build Notes

- The Docker image uses **Node.js 24 Alpine** for both builder and runtime stages
- CI validates the core Node workflows on both **Node.js 22** and **Node.js 24**
- Blog site build is skipped in Docker (separate dependencies)
- The runtime stage needs `gettext` (Alpine package) for `envsubst` in the nginx config
- If you hit `npm ci` sync errors in Docker, regenerate the lockfile with the container's npm version:
  ```bash
  docker run --rm -v "$(pwd)":/app -w /app node:24-alpine npm install --package-lock-only
  ```

## 🌐 Connecting to External Infrastructure

### Shared Redis (optional)

If you run other stacks that share a Redis instance, connect via an external network:

```yaml
# docker-compose.override.yml
services:
  redis:
    networks:
      - infra_default

networks:
  infra_default:
    external: true
```

### Self-Hosted LLM

Any OpenAI-compatible endpoint works (Ollama, vLLM, llama.cpp server, etc.):

```yaml
# docker-compose.override.yml
services:
  worldmonitor:
    environment:
      LLM_API_URL: "http://your-host:8000/v1/chat/completions"
      LLM_API_KEY: "your-key"
      LLM_MODEL: "your-model-name"
    extra_hosts:
      - "your-host:192.168.1.100"  # if not DNS-resolvable
```

## 🐛 Troubleshooting

| Issue | Fix |
|-------|-----|
| 📡 `0/55 OK` on health check | Seeders haven't run — `./scripts/run-seeders.sh` |
| 🔴 nginx won't start | Check `podman logs worldmonitor` — likely missing `gettext` package |
| 🔑 Seeders say "Missing UPSTASH_REDIS_REST_URL" | Stack isn't running, or run via `./scripts/run-seeders.sh` (auto-sets env vars) |
| 📦 `npm ci` fails in Docker build | Lockfile mismatch — regenerate with `docker run --rm -v $(pwd):/app -w /app node:24-alpine npm install --package-lock-only` |
| 🚢 No vessel data | Set `AISSTREAM_API_KEY` in both `worldmonitor` and `ais-relay` services |
| 🔥 No wildfire data | Set `NASA_FIRMS_API_KEY` |
| 🌐 No outage data | Requires `CLOUDFLARE_API_TOKEN` (paid Radar access) |

## 🖥️ Hetzner VPS Operations

For Hetzner Cloud, treat the VNC console as an emergency path only. Day-to-day management should happen over SSH with `systemd` and `docker compose`.

```bash
ssh root@your-server
systemctl status worldmonitor
journalctl -u worldmonitor -f
docker compose ps
docker compose logs -f worldmonitor
systemctl reload worldmonitor
```

Recommended baseline for 24/7 uptime:

- Enable Hetzner Backups or take a Snapshot before deployments.
- Mirror allowed ports in Hetzner Cloud Firewalls; do not rely on UFW alone for Docker-published ports.
- Use `/api/health` plus the bundled `scripts/health-check.sh` for alerting.
- Keep Discord notifications on a single execution path to avoid duplicate posts.
