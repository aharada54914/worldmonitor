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
#   ALERT_EMAIL         DEGRADED/UNHEALTHY 時の通知先メールアドレス
#   DISCORD_WEBHOOK_URL Discord への障害通知 (設定している場合)

WM_URL="${WM_URL:-http://localhost:3000}"
ALERT_COOLDOWN_MINUTES="${HEALTH_ALERT_COOLDOWN_MINUTES:-30}"
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

# ヘルスエンドポイントを取得
HTTP_RESPONSE=$(curl -sS --max-time 10 -w '\n__WM_HTTP_CODE__:%{http_code}' "${WM_URL}/api/health" 2>/dev/null)
CURL_RC=$?
HTTP_CODE=""
RESPONSE=""

if [ $CURL_RC -eq 0 ]; then
  HTTP_CODE=$(printf '%s' "$HTTP_RESPONSE" | sed -n 's/^__WM_HTTP_CODE__:\([0-9][0-9][0-9]\)$/\1/p' | tail -n 1)
  RESPONSE=$(printf '%s' "$HTTP_RESPONSE" | sed '/^__WM_HTTP_CODE__:[0-9][0-9][0-9]$/d')
fi

if [ $CURL_RC -ne 0 ]; then
  STATUS="UNREACHABLE"
else
  STATUS=$(extract_json_status "$RESPONSE")
  [ -z "$STATUS" ] && STATUS="UNKNOWN"
fi

if [ -n "$HTTP_CODE" ]; then
  echo "${TIMESTAMP} [${STATUS}] http=${HTTP_CODE}"
else
  echo "${TIMESTAMP} [${STATUS}]"
fi

PREV_STATUS=""
LAST_ALERT_EPOCH=0
if [ -f "$STATE_FILE" ]; then
  IFS='|' read -r PREV_STATUS LAST_ALERT_EPOCH < "$STATE_FILE" || true
fi

NOW_EPOCH=$(date +%s 2>/dev/null || printf '0')
COOLDOWN_SECONDS=$((ALERT_COOLDOWN_MINUTES * 60))
SHOULD_ALERT=0
SHOULD_RESOLVE=0

case "$STATUS" in
  DEGRADED|UNHEALTHY|UNREACHABLE)
    if [ "$PREV_STATUS" != "$STATUS" ]; then
      SHOULD_ALERT=1
    elif [ "${NOW_EPOCH:-0}" -ge $(( ${LAST_ALERT_EPOCH:-0} + COOLDOWN_SECONDS )) ]; then
      SHOULD_ALERT=1
    fi
    ;;
  *)
    case "$PREV_STATUS" in
      DEGRADED|UNHEALTHY|UNREACHABLE)
        SHOULD_RESOLVE=1
        ;;
    esac
    ;;
esac

# DEGRADED / UNHEALTHY / UNREACHABLE の場合にアラートを送信
case "$STATUS" in
  DEGRADED|UNHEALTHY|UNREACHABLE)
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
      LAST_ALERT_EPOCH="$NOW_EPOCH"
    else
      echo "ALERT SUPPRESSED: status=${STATUS} cooldown=${ALERT_COOLDOWN_MINUTES}m"
    fi
    ;;
esac

if [ "$SHOULD_RESOLVE" -eq 1 ]; then
  RESOLVED_MSG="${TIMESTAMP} World Monitor RECOVERED: status=${STATUS} http=${HTTP_CODE:-000} url=${WM_URL}"
  echo "RESOLVED: $RESOLVED_MSG"
  if [ -n "$ALERT_EMAIL" ] && command -v mail >/dev/null 2>&1; then
    echo "$RESOLVED_MSG" | mail -s "[WM] Health Recovered: ${STATUS}" "$ALERT_EMAIL"
  fi
  if [ -n "$DISCORD_WEBHOOK_URL" ]; then
    curl -sf -X POST "$DISCORD_WEBHOOK_URL" \
      -H 'Content-Type: application/json' \
      -d "{\"content\":\"✅ **World Monitor** 復旧\\nステータス: **${STATUS}**\\nHTTP: **${HTTP_CODE:-000}**\\n時刻: ${TIMESTAMP}\"}" \
      --max-time 10 >/dev/null 2>&1
  fi
fi

printf '%s|%s\n' "$STATUS" "${LAST_ALERT_EPOCH:-0}" > "$STATE_FILE"
