#!/bin/bash
# setup-vps.sh — Hetzner CAX21 (ARM64 Debian) 初期セットアップスクリプト
#
# 使い方:
#   sudo bash scripts/setup-vps.sh
#
# 実行内容:
#   1. Swap 2GB 追加 + vm.swappiness=10 設定
#   2. Docker インストール (未インストールの場合)
#   3. ufw ファイアウォール設定
#   4. worldmonitor.service を systemd に登録
#   5. cron ジョブ設定 (シード 30分 / Discord 通知 60分 / ヘルスチェック 2分)
#
# 前提条件:
#   - このスクリプトは /home/user/worldmonitor から実行することを想定
#   - root または sudo 権限が必要

set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_USER="${SUDO_USER:-$(whoami)}"

log()  { echo "[setup-vps] $*"; }
warn() { echo "[setup-vps] WARN: $*" >&2; }
die()  { echo "[setup-vps] ERROR: $*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "root または sudo で実行してください"

# ─── 1. Swap (2GB) ────────────────────────────────────────────────────────────
log "=== Swap 設定 ==="
if swapon --show | grep -q '/swapfile'; then
  log "Swap already enabled — skip"
else
  log "Creating 2GB swapfile..."
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  log "Swap enabled"
fi

# Swappiness (RAM が余裕ある間は Swap を使わない)
sysctl -w vm.swappiness=10
grep -q 'vm.swappiness' /etc/sysctl.d/99-worldmonitor.conf 2>/dev/null || \
  echo 'vm.swappiness=10' >> /etc/sysctl.d/99-worldmonitor.conf
log "vm.swappiness=10 設定完了"

# ─── 2. Docker ───────────────────────────────────────────────────────────────
log "=== Docker ==="
if command -v docker >/dev/null 2>&1; then
  log "Docker already installed: $(docker --version)"
else
  log "Installing Docker..."
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/debian/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  usermod -aG docker "$APP_USER"
  log "Docker installed"
fi
systemctl enable --now docker
log "Docker daemon enabled"

# ─── 3. ufw ファイアウォール ─────────────────────────────────────────────────
log "=== ufw ファイアウォール ==="
if ! command -v ufw >/dev/null 2>&1; then
  apt-get install -y -qq ufw
fi

ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    comment 'SSH'
ufw allow 3000/tcp  comment 'World Monitor HTTP'
ufw allow 80/tcp    comment 'HTTP (for TLS/Cloudflare)'
ufw allow 443/tcp   comment 'HTTPS'
ufw --force enable
log "ufw enabled (allowed: 22, 80, 443, 3000)"

# Docker が ufw をバイパスする問題の対策
DOCKER_DAEMON=/etc/docker/daemon.json
if [ ! -f "$DOCKER_DAEMON" ]; then
  echo '{"iptables": true, "userland-proxy": false}' > "$DOCKER_DAEMON"
  systemctl reload docker 2>/dev/null || true
  log "Docker daemon.json 設定"
fi

# ─── 4. systemd サービス ─────────────────────────────────────────────────────
log "=== systemd サービス ==="
SERVICE_SRC="$REPO_DIR/docker/worldmonitor.service"
SERVICE_DST="/etc/systemd/system/worldmonitor.service"

if [ -f "$SERVICE_SRC" ]; then
  # REPO_DIR をサービスファイルに埋め込む
  sed "s|__REPO_DIR__|${REPO_DIR}|g" "$SERVICE_SRC" > "$SERVICE_DST"
  systemctl daemon-reload
  systemctl enable worldmonitor
  log "worldmonitor.service 有効化"
else
  warn "docker/worldmonitor.service が見つかりません — systemd 設定をスキップ"
fi

# ─── 5. cron ジョブ ──────────────────────────────────────────────────────────
log "=== cron ジョブ ==="

# ログディレクトリ作成
LOG_DIR=/var/log
touch "$LOG_DIR/worldmonitor-seed.log" \
      "$LOG_DIR/worldmonitor-discord.log" \
      "$LOG_DIR/worldmonitor-health.log"
chown "$APP_USER" "$LOG_DIR/worldmonitor-seed.log" \
                  "$LOG_DIR/worldmonitor-discord.log" \
                  "$LOG_DIR/worldmonitor-health.log"

# ユーザーの crontab を設定
CRON_TMP=$(mktemp)
# 既存 crontab を取得 (存在しない場合は空)
crontab -u "$APP_USER" -l 2>/dev/null | grep -v worldmonitor > "$CRON_TMP" || true

cat >> "$CRON_TMP" <<EOF

# World Monitor — シードデータ更新 (30分ごと)
*/30 * * * * cd ${REPO_DIR} && ./scripts/run-seeders.sh >> /var/log/worldmonitor-seed.log 2>&1

# World Monitor — Discord 通知 (60分ごと)
0 * * * * cd ${REPO_DIR} && node scripts/discord-notify.mjs >> /var/log/worldmonitor-discord.log 2>&1

# World Monitor — ヘルスチェック (2分ごと)
*/2 * * * * ${REPO_DIR}/scripts/health-check.sh >> /var/log/worldmonitor-health.log 2>&1

# World Monitor — ログローテーション (週1回)
0 3 * * 0 truncate -s 0 /var/log/worldmonitor-seed.log /var/log/worldmonitor-discord.log /var/log/worldmonitor-health.log
EOF

crontab -u "$APP_USER" "$CRON_TMP"
rm -f "$CRON_TMP"
log "cron ジョブ設定完了"

# ─── 完了 ────────────────────────────────────────────────────────────────────
log ""
log "=== セットアップ完了 ==="
log "  Swap:     $(free -h | awk '/Swap:/ {print $2}')"
log "  Docker:   $(docker --version 2>/dev/null || echo 'n/a')"
log "  ufw:      $(ufw status | head -1)"
log "  systemd:  worldmonitor.service"
log "  crontab:  $(crontab -u "$APP_USER" -l 2>/dev/null | grep -c worldmonitor) ジョブ登録済み"
log ""
log "次のステップ:"
log "  1. docker-compose.override.yml に API キーを設定"
log "  2. docker compose up -d --build  でスタック起動"
log "  3. ./scripts/run-seeders.sh      で初回シード実行"
