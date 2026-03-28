#!/usr/bin/env node

import { formatSlashCommandLines } from './discord-slash-commands.mjs';

const DEFAULT_DASHBOARD_URL = 'http://localhost:3000';

export const GUIDE_CHANNEL_ORDER = ['welcome', 'how-to-use', 'commands', 'ops', 'alerts'];

const CHANNEL_ALIASES = new Map([
  ['welcome', 'welcome'],
  ['usage', 'how-to-use'],
  ['how-to-use', 'how-to-use'],
  ['how_to_use', 'how-to-use'],
  ['commands', 'commands'],
  ['ops', 'ops'],
  ['operations', 'ops'],
  ['alerts', 'alerts'],
]);

export function normalizeGuideChannelName(raw) {
  const key = String(raw || '').trim().toLowerCase();
  return CHANNEL_ALIASES.get(key) || null;
}

export function getDashboardUrl() {
  const raw = process.env.WM_PUBLIC_BASE_URL
    || process.env.WM_SITE_URL
    || process.env.WM_URL
    || DEFAULT_DASHBOARD_URL;
  return String(raw).replace(/\/+$/, '');
}

export function resolveGuideWebhookUrl(channelName, env = process.env) {
  const channel = normalizeGuideChannelName(channelName);
  if (!channel) return null;
  const suffix = channel.toUpperCase().replace(/-/g, '_');
  return env[`DISCORD_GUIDE_WEBHOOK_URL_${suffix}`]
    || env.DISCORD_GUIDE_WEBHOOK_URL_DEFAULT
    || (channel === 'alerts' ? env.DISCORD_WEBHOOK_URL : '')
    || null;
}

function buildWelcomeEmbeds() {
  const dashboardUrl = getDashboardUrl();
  return [
    {
      title: '🌍 World Monitor へようこそ',
      description: [
        'このサーバーは、世界の地政学・災害・市場・航空・海運の変化を追うための案内所です。',
        `ダッシュボード本体: ${dashboardUrl}`,
        'まずは pinned message とこの案内を上から順に読めば十分です。',
      ].join('\n'),
      color: 0x3498db,
      fields: [
        {
          name: 'ここでできること',
          value: [
            '・重要アラートを受け取る',
            '・ダッシュボードの見方を覚える',
            '・運用コマンドと復旧手順を確認する',
          ].join('\n'),
          inline: false,
        },
        {
          name: 'おすすめの見方',
          value: [
            '1. まず `#how-to-use` を読む',
            '2. 次に `#commands` を読む',
            '3. 最後に `#alerts` を監視用に使う',
          ].join('\n'),
          inline: false,
        },
      ],
      footer: { text: 'World Monitor Guide Post' },
    },
  ];
}

function buildHowToUseEmbeds() {
  return [
    {
      title: '📘 使い方',
      description: '高校生でも追えるように、見る順番を 4 ステップに分けています。',
      color: 0x2ecc71,
      fields: [
        {
          name: '1. まず色を見る',
          value: [
            '・赤: 危険度が高い',
            '・黄: 注意が必要',
            '・青/緑: 情報または落ち着いた状態',
          ].join('\n'),
          inline: false,
        },
        {
          name: '2. 見出しを読む',
          value: [
            '地震、紛争、軍用機、気象、市場などの見出しで分野を判別します。',
            '自分が追いたい分野だけ拾って大丈夫です。',
          ].join('\n'),
          inline: false,
        },
        {
          name: '3. 元データを見る',
          value: [
            'Discord は要約です。',
            '詳しく知りたいときはダッシュボード本体を開いて、同じ項目のパネルを見ます。',
          ].join('\n'),
          inline: false,
        },
        {
          name: '4. 誤報と未設定を区別する',
          value: [
            '`DEGRADED` は「完全停止」ではありません。',
            '外部 API キー未設定や upstream 側の障害でも warning が出ます。',
          ].join('\n'),
          inline: false,
        },
      ],
      footer: { text: 'World Monitor Guide Post' },
    },
  ];
}

function buildCommandsEmbeds() {
  const plannedCommands = formatSlashCommandLines();
  return [
    {
      title: '🧭 コマンド案内',
      description: [
        'World Monitor は webhook 投稿に加えて、基本的な Discord slash command に対応しました。',
        'slash command を使うには bot と Interactions Endpoint URL の設定が必要です。',
        'ここでは「利用できる slash command」と「今すぐ使える運用コマンド」を分けて案内します。',
      ].join('\n'),
      color: 0xf1c40f,
      fields: [
        {
          name: '利用できる slash command',
          value: plannedCommands.join('\n'),
          inline: false,
        },
        {
          name: '今すぐ使える運用コマンド',
          value: [
            '`systemctl status worldmonitor` サービス状態',
            '`systemctl restart worldmonitor` 再起動',
            '`journalctl -u worldmonitor -f` systemd ログ追跡',
            '`docker compose ps` コンテナ一覧',
            '`docker compose logs -f worldmonitor ais-relay` アプリログ追跡',
          ].join('\n'),
          inline: false,
        },
      ],
      footer: { text: 'Slash commands require bot configuration' },
    },
  ];
}

function buildOpsEmbeds() {
  return [
    {
      title: '🛠️ 運用チャンネル向けメモ',
      description: 'VPS 運用者が最初に見るべき確認項目です。',
      color: 0x9b59b6,
      fields: [
        {
          name: '通常確認',
          value: [
            '`systemctl status worldmonitor`',
            '`docker compose ps`',
            '`curl http://localhost:3000/api/health`',
          ].join('\n'),
          inline: false,
        },
        {
          name: '障害時の見る順番',
          value: [
            '1. `journalctl -u worldmonitor -n 100 --no-pager`',
            '2. `docker compose logs --tail=200 worldmonitor ais-relay`',
            '3. `docker compose ps` で unhealthy / exited を確認',
            '4. 必要なら `systemctl restart worldmonitor`',
          ].join('\n'),
          inline: false,
        },
        {
          name: '注意',
          value: [
            '`UNREACHABLE` は本当に到達不能なときだけ通知されます。',
            '`DEGRADED` は現在 Discord 通知を抑制しています。',
          ].join('\n'),
          inline: false,
        },
      ],
      footer: { text: 'World Monitor Guide Post' },
    },
  ];
}

function buildAlertsEmbeds() {
  return [
    {
      title: '🚨 アラートの意味',
      description: 'このチャンネルに流れる状態の読み方です。',
      color: 0xe74c3c,
      fields: [
        {
          name: '`UNREACHABLE`',
          value: 'HTTP 到達不能。アプリ停止、nginx 不達、ネットワーク断などの可能性があります。',
          inline: false,
        },
        {
          name: '`UNHEALTHY`',
          value: 'アプリには到達しているが、health 判定が重大異常です。',
          inline: false,
        },
        {
          name: '`DEGRADED`',
          value: '劣化状態です。現在は通知ノイズ削減のため、この状態だけでは Discord 通知しません。',
          inline: false,
        },
        {
          name: '復旧通知',
          value: '重大状態から抜けたときだけ「復旧」を送ります。',
          inline: false,
        },
      ],
      footer: { text: 'World Monitor Alert Policy' },
    },
  ];
}

export function buildGuideEmbeds(channelName) {
  const channel = normalizeGuideChannelName(channelName);
  if (!channel) {
    throw new Error(`Unknown guide channel: ${channelName}`);
  }
  switch (channel) {
    case 'welcome':
      return buildWelcomeEmbeds();
    case 'how-to-use':
      return buildHowToUseEmbeds();
    case 'commands':
      return buildCommandsEmbeds();
    case 'ops':
      return buildOpsEmbeds();
    case 'alerts':
      return buildAlertsEmbeds();
    default:
      throw new Error(`Unsupported guide channel: ${channel}`);
  }
}
