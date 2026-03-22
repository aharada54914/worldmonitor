# Settings Management

This document separates World Monitor settings into three buckets:

1. `user_local`
   Settings stored in the browser profile with `localStorage` or IndexedDB.
   These are personal UX choices and should not be edited from infrastructure tools.

2. `instance_default`
   Runtime defaults served by `/api/local-instance-config`.
   Operators can manage these through Docker stack environment variables.
   Users can still override them locally.

3. `instance_secret`
   API keys, relay URLs, and other deployment credentials.
   These belong in Docker stack environment variables or Docker secrets.

## Tool Fit

| Tool | Fit | Use for |
| --- | --- | --- |
| Portainer | Best | Docker stack env vars, redeploys, logs, console, container health |
| Cockpit | Good secondary | Host OS, services, firewall, storage, terminal |
| lazydocker | Ops only | Logs, restart, inspect, shell into containers |
| tmux | Ops only | Persistent terminal sessions and admin command workflows |

## user_local

These remain per-user settings today.

| Area | Keys / examples | Storage |
| --- | --- | --- |
| Theme and font | `worldmonitor-theme`, `wm-font-family` | localStorage |
| Map preferences | `wm-map-provider`, `wm-map-theme:*` | localStorage |
| Globe preferences | `wm-globe-render-scale`, `wm-globe-visual-preset`, `wm-globe-texture` | localStorage |
| AI UX toggles | `wm-ai-flow-browser-model`, `wm-ai-flow-cloud-llm`, `wm-map-news-flash`, `wm-headline-memory`, `wm-badge-animation` | localStorage |
| Media | `wm-stream-quality`, `wm-live-streams-always-on` | localStorage |
| Alerts | `wm-breaking-alerts-v1`, `wm-breaking-alerts-dedupe` | localStorage |
| Layout | `worldmonitor-panels`, `worldmonitor-monitors`, `worldmonitor-layers`, `worldmonitor-panel-order`, `worldmonitor-panel-spans` | localStorage |
| Widgets | `wm-custom-widgets`, `wm-pro-html-*`, `wm-widget-key`, `wm-pro-key` | localStorage |
| Persistence export/import | `worldmonitor-*`, `wm-*`, `map-*`, `positive-threshold` | localStorage export/import |

## instance_default

These are now runtime-readable defaults for self-hosted operators.
Set them in Portainer stack environment variables and redeploy the stack.

| Env var | Purpose | Allowed values |
| --- | --- | --- |
| `WM_INSTANCE_THEME` | Default theme preference | `auto`, `dark`, `light` |
| `WM_INSTANCE_FONT_FAMILY` | Default font family | `mono`, `system` |
| `WM_INSTANCE_MAP_PROVIDER` | Default map provider | `auto`, `pmtiles`, `openfreemap`, `carto` |
| `WM_INSTANCE_MAP_THEME` | Default map theme | provider-specific string |
| `WM_INSTANCE_GLOBE_PRESET` | Default globe visual preset | `classic`, `enhanced` |
| `WM_INSTANCE_LANGUAGE` | Default language before first local override | supported short language code |
| `WM_INSTANCE_STREAM_QUALITY` | Default stream quality | `auto`, `small`, `medium`, `large`, `hd720` |
| `WM_INSTANCE_LIVE_STREAMS_ALWAYS_ON` | Default stream auto-pause behavior | boolean |
| `WM_INSTANCE_MAP_NEWS_FLASH` | Default map flash behavior | boolean |
| `WM_INSTANCE_HEADLINE_MEMORY` | Default headline memory toggle | boolean |
| `WM_INSTANCE_BADGE_ANIMATION` | Default badge animation toggle | boolean |
| `WM_INSTANCE_CLOUD_LLM` | Default cloud AI toggle | boolean |
| `WM_INSTANCE_BROWSER_MODEL` | Default browser AI toggle | boolean |
| `WM_INSTANCE_BREAKING_ALERTS_ENABLED` | Default breaking alert enablement | boolean |
| `WM_INSTANCE_BREAKING_ALERTS_SOUND` | Default alert sound | boolean |
| `WM_INSTANCE_BREAKING_ALERTS_DESKTOP_NOTIFICATIONS` | Default desktop notifications | boolean |
| `WM_INSTANCE_BREAKING_ALERTS_SENSITIVITY` | Default alert threshold | `critical-only`, `critical-and-high` |

## instance_secret

Manage these in Portainer stack env vars or Docker secrets.
Representative examples:

- AI providers: `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `OLLAMA_API_URL`, `OLLAMA_MODEL`
- Data providers: `FINNHUB_API_KEY`, `FRED_API_KEY`, `EIA_API_KEY`, `NASA_FIRMS_API_KEY`
- Conflict and aviation: `ACLED_ACCESS_TOKEN`, `UCDP_ACCESS_TOKEN`, `AVIATIONSTACK_API`, `ICAO_API_KEY`, `WINGBITS_API_KEY`
- Relay and transport: `WS_RELAY_URL`, `AISSTREAM_API_KEY`, `OPENSKY_CLIENT_ID`, `OPENSKY_CLIENT_SECRET`
- Shared infra: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `RELAY_SHARED_SECRET`

## Portainer Workflow

1. Open the stack in Portainer.
2. Edit the stack environment variables.
3. Change `WM_INSTANCE_*` for runtime defaults.
4. Change provider keys under the same stack for secrets.
5. Redeploy the stack.
6. Verify `/api/local-instance-config` and container health.

Starter template:

- [docker-compose.portainer.example.yml](/Users/jrmag/worldmonitor/docker-compose.portainer.example.yml)
