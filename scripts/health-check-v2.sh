#!/bin/sh
# health-check-v2.sh — World Monitor incident-aware health checker
#
# Improvements over scripts/health-check.sh:
# - polls compact health output
# - alerts on incident transitions / fingerprint changes
# - reminders are opt-in, disabled by default
# - Discord alert includes fingerprint for dedupe/debugging

WM_URL="${WM_URL:-http://localhost:3000}"
STATE_DIR="${WM_STATE_DIR:-/tmp/worldmonitor}"
STATE_FILE="${STATE_DIR}/health-check-v2.state"
HEALTH_ALERT_REMINDER_MINUTES="${HEALTH_ALERT_REMINDER_MINUTES:-0}"
TIMESTAMP="$(date -Iseconds 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S')"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)"

load_env_file() {
  env_path="$1"
  [ -f "$env_path" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    trimmed=$(printf '%s' "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    [ -n "$trimmed" ] || continue
    case "$trimmed" in
      \#*) continue ;;
      *=*)
        key=${trimmed%%=*}
        val=${trimmed#*=}
        val=$(printf '%s' "$val" | sed "s/^['\"]//;s/['\"]$//")
        eval "current=\${$key:-}"
        [ -n "$current" ] || export "$key=$val"
        ;;
    esac
  done < "$env_path"
}

load_override_env() {
  override_path="$1"
  [ -f "$override_path" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    entry=$(printf '%s' "$line" | sed 's/^[[:space:]]*//')
    case "$entry" in
      DISCORD_WEBHOOK_URL:*|ALERT_EMAIL:*)
        key=${entry%%:*}
        val=${entry#*:}
        val=$(printf '%s' "$val" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        val=$(printf '%s' "$val" | sed "s/^['\"]//;s/['\"]$//")
        eval "current=\${$key:-}"
        [ -n "$current" ] || export "$key=$val"
        ;;
    esac
  done < "$override_path"
}

load_env_file "${PROJECT_DIR}/.env.local"
load_override_env "${PROJECT_DIR}/docker-compose.override.yml"
mkdir -p "$STATE_DIR"

extract_json_status() {
  body="$1"
  printf '%s' "$body" \
    | tr -d '\n' \
    | grep -o '"status"[[:space:]]*:[[:space:]]*"[^"]*"' \
    | head -n 1 \
    | sed 's/.*:[[:space:]]*"\([^"]*\)"/\1/'
}

extract_summary_count() {
  body="$1"
  key="$2"
  printf '%s' "$body" \
    | tr -d '\n' \
    | grep -o "\"${key}\"[[:space:]]*:[[:space:]]*[0-9][0-9]*" \
    | head -n 1 \
    | sed 's/.*:[[:space:]]*//'
}

is_severe_status() {
  case "$1" in
    UNHEALTHY|UNREACHABLE) return 0 ;;
    *) return 1 ;;
  esac
}

HTTP_RESPONSE=$(curl -sS --max-time 10 -w '\n__WM_HTTP_CODE__:%{http_code}' "${WM_URL}/api/health?compact=1" 2>/dev/null)
CURL_RC=$?
HTTP_CODE=""
RESPONSE=""

if [ $CURL_RC -eq 0 ]; then
  HTTP_CODE=$(printf '%s' "$HTTP_RESPONSE" | sed -n 's/^__WM_HTTP_CODE__:\([0-9][0-9][0-9]\)$/\1/p' | tail -n 1)
  RESPONSE=$(printf '%s' "$HTTP_RESPONSE" | sed '/^__WM_HTTP_CODE__:[0-9][0-9][0-9]$/d')
fi

if [ $CURL_RC -ne 0 ]; then
  STATUS="UNREACHABLE"
  RESPONSE='{"status":"UNREACHABLE"}'
else
  STATUS=$(extract_json_status "$RESPONSE")
  [ -z "$STATUS" ] && STATUS="UNKNOWN"
fi

WARN_COUNT=$(extract_summary_count "$RESPONSE" "warn")
CRIT_COUNT=$(extract_summary_count "$RESPONSE" "crit")
[ -z "$WARN_COUNT" ] && WARN_COUNT=0
[ -z "$CRIT_COUNT" ] && CRIT_COUNT=0

FINGERPRINT=$(printf '%s' "${STATUS}|${HTTP_CODE}|${RESPONSE}" | cksum | awk '{print $1}')
NOW_EPOCH=$(date +%s 2>/dev/null || printf '0')

if [ -n "$HTTP_CODE" ]; then
  echo "${TIMESTAMP} [${STATUS}] http=${HTTP_CODE} warn=${WARN_COUNT} crit=${CRIT_COUNT} fp=${FINGERPRINT}"
else
  echo "${TIMESTAMP} [${STATUS}] warn=${WARN_COUNT} crit=${CRIT_COUNT} fp=${FINGERPRINT}"
fi

PREV_STATUS=""
PREV_FINGERPRINT=""
LAST_ALERT_EPOCH=0
if [ -f "$STATE_FILE" ]; then
  IFS='|' read -r PREV_STATUS PREV_FINGERPRINT LAST_ALERT_EPOCH < "$STATE_FILE" || true
fi

SHOULD_ALERT=0
SHOULD_RESOLVE=0
REASON=""

if is_severe_status "$STATUS"; then
  if ! is_severe_status "$PREV_STATUS"; then
    SHOULD_ALERT=1
    REASON="incident-opened"
  elif [ "$PREV_FINGERPRINT" != "$FINGERPRINT" ]; then
    SHOULD_ALERT=1
    REASON="incident-changed"
  elif [ "${HEALTH_ALERT_REMINDER_MINUTES:-0}" -gt 0 ] && [ "${NOW_EPOCH:-0}" -ge $(( ${LAST_ALERT_EPOCH:-0} + (HEALTH_ALERT_REMINDER_MINUTES * 60) )) ]; then
    SHOULD_ALERT=1
    REASON="incident-reminder"
  fi
else
  if is_severe_status "$PREV_STATUS"; then
    SHOULD_RESOLVE=1
  fi
fi

send_discord_message() {
  content="$1"
  [ -n "$DISCORD_WEBHOOK_URL" ] || return 0
  curl -sf -X POST "$DISCORD_WEBHOOK_URL" \
    -H 'Content-Type: application/json' \
    -d "{\"content\":\"${content}\"}" \
    --max-time 10 >/dev/null 2>&1
}

escape_discord() {
  printf '%s' "$1" | sed 's/\\/\\\\/g;s/"/\\"/g'
}

if [ "$SHOULD_ALERT" -eq 1 ]; then
  ALERT_MSG="${TIMESTAMP} World Monitor ALERT: status=${STATUS} http=${HTTP_CODE:-000} warn=${WARN_COUNT} crit=${CRIT_COUNT} fp=${FINGERPRINT} reason=${REASON} url=${WM_URL}"
  echo "ALERT: $ALERT_MSG"

  if [ -n "$ALERT_EMAIL" ] && command -v mail >/dev/null 2>&1; then
    echo "$ALERT_MSG" | mail -s "[WM] Health Alert: ${STATUS}" "$ALERT_EMAIL"
  fi

  DISCORD_CONTENT=$(escape_discord "🚨 **World Monitor** incident\nステータス: **${STATUS}**\nHTTP: **${HTTP_CODE:-000}**\nwarn/crit: **${WARN_COUNT}/${CRIT_COUNT}**\nreason: **${REASON}**\nfingerprint: \`${FINGERPRINT}\`\n時刻: ${TIMESTAMP}")
  send_discord_message "$DISCORD_CONTENT"
  LAST_ALERT_EPOCH="$NOW_EPOCH"
else
  echo "ALERT SUPPRESSED: status=${STATUS} fp=${FINGERPRINT}"
fi

if [ "$SHOULD_RESOLVE" -eq 1 ]; then
  RESOLVED_MSG="${TIMESTAMP} World Monitor RECOVERED: status=${STATUS} http=${HTTP_CODE:-000} warn=${WARN_COUNT} crit=${CRIT_COUNT} url=${WM_URL}"
  echo "RESOLVED: $RESOLVED_MSG"

  if [ -n "$ALERT_EMAIL" ] && command -v mail >/dev/null 2>&1; then
    echo "$RESOLVED_MSG" | mail -s "[WM] Health Recovered: ${STATUS}" "$ALERT_EMAIL"
  fi

  DISCORD_CONTENT=$(escape_discord "✅ **World Monitor** recovered\nステータス: **${STATUS}**\nHTTP: **${HTTP_CODE:-000}**\nwarn/crit: **${WARN_COUNT}/${CRIT_COUNT}**\n時刻: ${TIMESTAMP}")
  send_discord_message "$DISCORD_CONTENT"
fi

printf '%s|%s|%s\n' "$STATUS" "$FINGERPRINT" "${LAST_ALERT_EPOCH:-0}" > "$STATE_FILE"
