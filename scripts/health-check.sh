#!/bin/sh
# health-check.sh — World Monitor ヘルスチェックスクリプト
#
# 使い方:
#   ./scripts/health-check.sh
#
# 推奨 cron 設定 (2分ごと):
#   */2 * * * * /home/user/worldmonitor/scripts/health-check.sh >> /var/log/worldmonitor-health.log 2>&1
#
# 環境変数:
#   WM_URL              監視対象 URL (デフォルト: http://localhost:3000)
#   ALERT_EMAIL         重大障害時の通知先メールアドレス
#   DISCORD_WEBHOOK_URL Discord への障害通知 (設定している場合)

WM_URL="${WM_URL:-http://localhost:3000}"
HEALTH_PATH="${WM_HEALTH_PATH:-/api/health?compact=1}"
ALERT_REPEAT_MINUTES="${HEALTH_ALERT_REPEAT_MINUTES:-0}"
STATE_DIR="${WM_STATE_DIR:-/tmp/worldmonitor}"
STATE_FILE="${STATE_DIR}/health-check.state"
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

extract_json_bool() {
  body="$1"
  key="$2"
  printf '%s' "$body" \
    | tr -d '\n' \
    | grep -o "\"$key\"[[:space:]]*:[[:space:]]*\\(true\\|false\\)" \
    | head -n 1 \
    | sed 's/.*:[[:space:]]*//'
}

# ヘルスエンドポイントを取得
HTTP_RESPONSE=$(curl -sS --max-time 10 -w '\n__WM_HTTP_CODE__:%{http_code}' "${WM_URL}${HEALTH_PATH}" 2>/dev/null)
CURL_RC=$?
HTTP_CODE=""
RESPONSE=""
SHOULD_PAGE=0

if [ $CURL_RC -eq 0 ]; then
  HTTP_CODE=$(printf '%s' "$HTTP_RESPONSE" | sed -n 's/^__WM_HTTP_CODE__:\([0-9][0-9][0-9]\)$/\1/p' | tail -n 1)
  RESPONSE=$(printf '%s' "$HTTP_RESPONSE" | sed '/^__WM_HTTP_CODE__:[0-9][0-9][0-9]$/d')
fi

if [ $CURL_RC -ne 0 ]; then
  STATUS="UNREACHABLE"
  SHOULD_PAGE=1
else
  STATUS=$(extract_json_status "$RESPONSE")
  [ -z "$STATUS" ] && STATUS="UNKNOWN"
  PAGE_FLAG=$(extract_json_bool "$RESPONSE" "shouldPage")
  [ "$PAGE_FLAG" = "true" ] && SHOULD_PAGE=1
  if [ "$STATUS" = "UNKNOWN" ] && [ -n "$HTTP_CODE" ] && [ "$HTTP_CODE" -ge 500 ]; then
    STATUS="UNREACHABLE"
    SHOULD_PAGE=1
  fi
fi

if [ -n "$HTTP_CODE" ]; then
  echo "${TIMESTAMP} [${STATUS}] http=${HTTP_CODE} shouldPage=${SHOULD_PAGE}"
else
  echo "${TIMESTAMP} [${STATUS}] shouldPage=${SHOULD_PAGE}"
fi

PREV_STATUS=""
LAST_ALERT_EPOCH=0
if [ -f "$STATE_FILE" ]; then
  IFS='|' read -r PREV_STATUS LAST_ALERT_EPOCH < "$STATE_FILE" || true
fi
# Guard against a corrupt/legacy state file: the epoch must be a plain integer
# of sane width. An 11-digit cap stays well inside 64-bit range (epochs are 10
# digits today, 11 until the year ~5138), so an out-of-range value can never
# later break `[ -gt ]` or `$(( ))` and silently strand an open incident.
case "${LAST_ALERT_EPOCH:-}" in
  ''|*[!0-9]*) LAST_ALERT_EPOCH=0 ;;
  *) [ "${#LAST_ALERT_EPOCH}" -gt 11 ] && LAST_ALERT_EPOCH=0 ;;
esac

NOW_EPOCH=$(date +%s 2>/dev/null || printf '0')
REPEAT_SECONDS=$((ALERT_REPEAT_MINUTES * 60))

# LAST_ALERT_EPOCH > 0 is the single source of truth for "a paging incident is
# currently OPEN" (we alerted and have not resolved it yet). Incident state is
# NEVER inferred from the textual status — that was the root cause of the recovery
# spam: a non-paging data status such as UNHEALTHY used to masquerade as an open
# incident, so the script re-sent "✅ 復旧 / ステータス: UNHEALTHY" on every tick.
INCIDENT_OPEN=0
[ "$LAST_ALERT_EPOCH" -gt 0 ] && INCIDENT_OPEN=1

SHOULD_ALERT=0
SHOULD_RESOLVE=0

if [ "$SHOULD_PAGE" -eq 1 ]; then
  if [ "$INCIDENT_OPEN" -eq 0 ]; then
    SHOULD_ALERT=1                       # new incident — open it and page once
  elif [ "$PREV_STATUS" != "$STATUS" ]; then
    SHOULD_ALERT=1                       # severe status changed — re-page on the transition
  elif [ "$ALERT_REPEAT_MINUTES" -gt 0 ] && [ "${NOW_EPOCH:-0}" -ge $(( LAST_ALERT_EPOCH + REPEAT_SECONDS )) ]; then
    SHOULD_ALERT=1                       # opt-in reminder cadence elapsed
  fi
elif [ "$INCIDENT_OPEN" -eq 1 ]; then
  SHOULD_RESOLVE=1                       # paging cleared while an incident was open — resolve once
fi

if [ "$SHOULD_PAGE" -eq 1 ]; then
  ALERT_MSG="${TIMESTAMP} World Monitor ALERT: status=${STATUS} http=${HTTP_CODE:-000} url=${WM_URL}"
  if [ "$SHOULD_ALERT" -eq 1 ]; then
    echo "ALERT: $ALERT_MSG"

    # メール通知 (mailutils/sendmail が使える場合)
    if [ -n "$ALERT_EMAIL" ] && command -v mail >/dev/null 2>&1; then
      echo "$ALERT_MSG" | mail -s "[WM] Health Alert: ${STATUS}" "$ALERT_EMAIL"
    fi

    # Discord 通知 (DISCORD_WEBHOOK_URL が設定されている場合)
    if [ -n "$DISCORD_WEBHOOK_URL" ]; then
      curl -sf -X POST "$DISCORD_WEBHOOK_URL" \
        -H 'Content-Type: application/json' \
        -d "{\"content\":\"🚨 **World Monitor** ヘルスアラート\\nステータス: **${STATUS}**\\nHTTP: **${HTTP_CODE:-000}**\\n時刻: ${TIMESTAMP}\"}" \
        --max-time 10 >/dev/null 2>&1
    fi
    LAST_ALERT_EPOCH="$NOW_EPOCH"        # (re)open the incident at this tick
  else
    echo "ALERT SUPPRESSED: status=${STATUS} repeat=${ALERT_REPEAT_MINUTES}m"
  fi
elif [ "$STATUS" = "DEGRADED" ] || [ "$STATUS" = "WARNING" ] || [ "$STATUS" = "UNHEALTHY" ]; then
  echo "ALERT SKIPPED: status=${STATUS} shouldPage=${SHOULD_PAGE}"
fi

if [ "$SHOULD_RESOLVE" -eq 1 ]; then
  RESOLVED_MSG="${TIMESTAMP} World Monitor RECOVERED: status=${STATUS} http=${HTTP_CODE:-000} url=${WM_URL}"
  echo "RESOLVED: $RESOLVED_MSG"
  if [ -n "$ALERT_EMAIL" ] && command -v mail >/dev/null 2>&1; then
    echo "$RESOLVED_MSG" | mail -s "[WM] Health Recovered: ${STATUS}" "$ALERT_EMAIL"
  fi
  if [ -n "$DISCORD_WEBHOOK_URL" ]; then
    # The alert that opened this incident was a *paging* (availability) alert, so
    # recovery announces that the paging condition cleared. When the data layer is
    # still degraded (a non-paging concern) we surface it as separate, clearly
    # labelled context instead of printing a contradictory
    # "✅ 復旧 / ステータス: UNHEALTHY" headline.
    if [ "$STATUS" = "HEALTHY" ]; then
      RESOLVE_CONTENT="✅ **World Monitor** 復旧\\nステータス: **HEALTHY**\\nHTTP: **${HTTP_CODE:-000}**\\n時刻: ${TIMESTAMP}"
    else
      RESOLVE_CONTENT="✅ **World Monitor** 復旧（ページング状態を解除）\\n到達性: **回復** (HTTP ${HTTP_CODE:-000})\\nデータ状態: **${STATUS}**（データ鮮度の問題・ページ対象外）\\n時刻: ${TIMESTAMP}"
    fi
    curl -sf -X POST "$DISCORD_WEBHOOK_URL" \
      -H 'Content-Type: application/json' \
      -d "{\"content\":\"${RESOLVE_CONTENT}\"}" \
      --max-time 10 >/dev/null 2>&1
  fi
  LAST_ALERT_EPOCH=0                     # close the incident so it cannot re-resolve
fi

printf '%s|%s\n' "$STATUS" "${LAST_ALERT_EPOCH:-0}" > "$STATE_FILE"
