# Discord alerting refactor plan

This plan addresses two noisy behaviors observed in self-hosted World Monitor deployments:

1. Health alerts repeat even when the incident has not materially changed.
2. The periodic Discord digest posts a low-value message when AI summarization is unavailable.

## Goals

- Send health alerts on **incident transitions**, not on a fixed cooldown loop.
- Keep optional reminders **opt-in**, not default.
- Make Discord digests still useful when AI is unavailable by emitting a deterministic fallback summary.
- Surface **why** AI summarization failed in logs and in embed metadata without dumping raw provider errors into the Discord channel.

## Drop-in files in this PR

- `scripts/health-check-v2.sh`
- `scripts/discord-notify-v2.mjs`
- `tests/discord-notify-v2.test.mjs`

## Migration

### Health alert cron
Replace:

```bash
*/2 * * * * /path/to/worldmonitor/scripts/health-check.sh >> /var/log/worldmonitor-health.log 2>&1
```

with:

```bash
*/2 * * * * /path/to/worldmonitor/scripts/health-check-v2.sh >> /var/log/worldmonitor-health.log 2>&1
```

### Discord digest cron or daemon
Replace:

```bash
node scripts/discord-notify.mjs
```

with:

```bash
node scripts/discord-notify-v2.mjs
```

or:

```bash
node scripts/discord-notify-v2.mjs --daemon
```

## New behavior

### `health-check-v2.sh`

- Uses `/api/health?compact=1`.
- Computes an **incident fingerprint** from status, HTTP code, and compact response body checksum.
- Alerts only when:
  - status moves into a severe state (`UNHEALTHY` or `UNREACHABLE`)
  - the incident fingerprint changes
  - an optional reminder timer is enabled and has elapsed
- Recovers once when the system exits a severe state.
- Default reminder cadence is **disabled**. Set `HEALTH_ALERT_REMINDER_MINUTES` to a positive number to opt in.

### `discord-notify-v2.mjs`

- Tries Gemini direct first, then OpenRouter.
- Converts provider failures into structured diagnostic codes:
  - `AI_DISABLED`
  - `AI_RATE_LIMITED`
  - `AI_PROVIDER_ERROR`
  - `AI_MODEL_NOT_FOUND`
  - `AI_EMPTY_INPUT`
- Falls back to a deterministic summary when AI is unavailable.
- Keeps the embed useful even when AI fails.
- Emits provider/fallback diagnostics in the footer and logs.

## Suggested next step

If you want to fully replace the original scripts, the next follow-up PR should swap call sites in:
- `docker/supervisord.conf`
- docs that reference the old script names
- any VPS setup automation
