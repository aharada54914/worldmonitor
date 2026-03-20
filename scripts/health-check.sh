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
TIMESTAMP="$(date -Iseconds 2>/dev/null || date '+%Y-%m-%dT%H:%M:%S')"

# ヘルスエンドポイントを取得
RESPONSE=$(curl -sf --max-time 10 "${WM_URL}/api/health" 2>/dev/null)
CURL_RC=$?

if [ $CURL_RC -ne 0 ]; then
  STATUS="UNREACHABLE"
else
  STATUS=$(echo "$RESPONSE" | grep -o '"status":"[^"]*"' | head -1 | sed 's/"status":"//;s/"//')
  [ -z "$STATUS" ] && STATUS="UNKNOWN"
fi

echo "${TIMESTAMP} [${STATUS}]"

# DEGRADED / UNHEALTHY / UNREACHABLE の場合にアラートを送信
case "$STATUS" in
  DEGRADED|UNHEALTHY|UNREACHABLE)
    ALERT_MSG="${TIMESTAMP} World Monitor ALERT: status=${STATUS} url=${WM_URL}"
    echo "ALERT: $ALERT_MSG"

    # メール通知 (mailutils/sendmail が使える場合)
    if [ -n "$ALERT_EMAIL" ] && command -v mail >/dev/null 2>&1; then
      echo "$ALERT_MSG" | mail -s "[WM] Health Alert: ${STATUS}" "$ALERT_EMAIL"
    fi

    # Discord 通知 (DISCORD_WEBHOOK_URL が設定されている場合)
    if [ -n "$DISCORD_WEBHOOK_URL" ]; then
      curl -sf -X POST "$DISCORD_WEBHOOK_URL" \
        -H 'Content-Type: application/json' \
        -d "{\"content\":\"🚨 **World Monitor** ヘルスアラート\\nステータス: **${STATUS}**\\n時刻: ${TIMESTAMP}\"}" \
        --max-time 10 >/dev/null 2>&1
    fi
    ;;
esac
