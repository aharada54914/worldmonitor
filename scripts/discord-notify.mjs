#!/usr/bin/env node
/**
 * discord-notify.mjs
 *
 * World Monitor → Gemini → Discord 定期通知スクリプト
 *
 * 使い方:
 *   node scripts/discord-notify.mjs              # 1回実行 (cron 向け)
 *   node scripts/discord-notify.mjs --daemon     # 定期実行 (supervisord 向け)
 *
 * 必須環境変数:
 *   DISCORD_WEBHOOK_URL             Discord チャンネルの Webhook URL
 *   GEMINI_API_KEY                  Google Gemini API キー
 *                                   (または OPENROUTER_API_KEY でフォールバック)
 *
 * 任意環境変数:
 *   OPENROUTER_API_KEY              Gemini が使えない場合のフォールバック
 *   GEMINI_MODEL                    デフォルト: gemini-2.0-flash
 *   DISCORD_NOTIFY_INTERVAL_MINUTES 通知間隔(分) デフォルト: 60
 *   DISCORD_NOTIFY_LANGUAGE         ja | en  デフォルト: ja
 *   UPSTASH_REDIS_REST_URL          Redis REST プロキシ URL
 *   UPSTASH_REDIS_REST_TOKEN        Redis REST トークン
 */

import { loadEnvFile, getRedisCredentials } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

// ─── 設定 ────────────────────────────────────────────────────────────────────

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const GEMINI_API_KEY      = process.env.GEMINI_API_KEY;
const OPENROUTER_API_KEY  = process.env.OPENROUTER_API_KEY;
const GEMINI_MODEL        = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const LANGUAGE            = (process.env.DISCORD_NOTIFY_LANGUAGE || 'ja').toLowerCase();
const INTERVAL_MIN        = Math.max(1, parseInt(process.env.DISCORD_NOTIFY_INTERVAL_MINUTES || '60', 10));
const IS_DAEMON           = process.argv.includes('--daemon');

const COLOR = {
  ALERT:   0xE74C3C,
  WARNING: 0xE67E22,
  INFO:    0x3498DB,
  OK:      0x2ECC71,
};

// ─── Redis ───────────────────────────────────────────────────────────────────

async function redisGet(key) {
  let creds;
  try { creds = getRedisCredentials(); } catch { return null; }
  try {
    const resp = await fetch(`${creds.url}/get/${encodeURIComponent(key)}`, {
      headers: { Authorization: `Bearer ${creds.token}` },
      signal: AbortSignal.timeout(8_000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.result ? JSON.parse(data.result) : null;
  } catch {
    return null;
  }
}

// ─── データ取得 ───────────────────────────────────────────────────────────────

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function isRecent(ts, withinMs = ONE_DAY_MS) {
  if (!ts) return false;
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  return !isNaN(t) && Date.now() - t < withinMs;
}

async function fetchWorldData() {
  const results = await Promise.allSettled([
    redisGet('seismology:earthquakes:v1'),
    redisGet('unrest:events:v1'),
    redisGet('military:flights:v1'),
    redisGet('natural:events:v1'),
    redisGet('weather:alerts:v1'),
    redisGet('cyber:threats:v2'),
    redisGet('market:stocks-bootstrap:v1'),
    redisGet('conflict:ucdp-events:v1'),
  ]);

  const get = (r) => (r.status === 'fulfilled' ? r.value : null);
  const [eqRaw, unrestRaw, milRaw, naturalRaw, weatherRaw, cyberRaw, marketRaw, conflictRaw] = results;

  const quakes = (get(eqRaw)?.earthquakes ?? [])
    .filter(q => q.magnitude >= 5.0 && isRecent(q.occurredAt))
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, 5);

  const unrest = (get(unrestRaw)?.events ?? [])
    .filter(e => e.severity === 'HIGH' && isRecent(e.occurredAt))
    .slice(0, 5);

  const milFlights = (get(milRaw)?.flights ?? [])
    .filter(f => f.riskLevel === 'HIGH')
    .slice(0, 5);

  const natural = (get(naturalRaw)?.events ?? [])
    .filter(e => !e.closed && ['VOLCANOES', 'SEVERE_STORMS', 'FLOODS', 'WILDFIRES'].includes(e.category))
    .sort((a, b) => Date.parse(b.date || 0) - Date.parse(a.date || 0))
    .slice(0, 5);

  const weather = (get(weatherRaw)?.alerts ?? [])
    .filter(a => ['EXTREME', 'SEVERE'].includes(a.severity))
    .slice(0, 5);

  const cyber = (get(cyberRaw)?.threats ?? [])
    .filter(t => t.severity === 'CRITICAL' && isRecent(t.firstSeen))
    .slice(0, 5);

  const stocks = get(marketRaw)?.stocks ?? get(marketRaw)?.quotes ?? [];
  const topMovers = [...stocks]
    .filter(s => typeof s.changePercent === 'number' && Math.abs(s.changePercent) >= 2)
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
    .slice(0, 5);

  const conflicts = (get(conflictRaw)?.events ?? [])
    .filter(e => isRecent(e.date ?? e.occurredAt, 7 * ONE_DAY_MS))
    .slice(0, 5);

  return { quakes, unrest, milFlights, natural, weather, cyber, topMovers, conflicts };
}

// ─── Gemini 呼び出し ──────────────────────────────────────────────────────────

async function callGeminiDirect(prompt) {
  if (!GEMINI_API_KEY) return null;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 1200 },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      const err = await resp.text().catch(() => '');
      console.warn(`[discord-notify] Gemini HTTP ${resp.status}: ${err.slice(0, 200)}`);
      return null;
    }
    const data = await resp.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
  } catch (err) {
    console.warn(`[discord-notify] Gemini error: ${err.message}`);
    return null;
  }
}

async function callGeminiViaOpenRouter(prompt) {
  if (!OPENROUTER_API_KEY) return null;
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://worldmonitor.app',
        'X-Title': 'World Monitor',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: 1200,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    return data.choices?.[0]?.message?.content?.trim() ?? null;
  } catch (err) {
    console.warn(`[discord-notify] OpenRouter error: ${err.message}`);
    return null;
  }
}

async function summarizeWithGemini(worldData) {
  const { quakes, unrest, milFlights, natural, weather, cyber, topMovers, conflicts } = worldData;

  const langInstr = LANGUAGE === 'ja'
    ? '日本語で、簡潔かつ具体的に回答してください。'
    : 'Answer concisely and specifically in English.';

  const sections = [
    quakes.length > 0 && `## 地震 (M5.0以上)\n${quakes.map(q =>
      `- M${q.magnitude} ${q.place ?? (q.location ? `${q.location.latitude?.toFixed(1)}, ${q.location.longitude?.toFixed(1)}` : '')}`
    ).join('\n')}`,

    unrest.length > 0 && `## 社会不安・抗議活動\n${unrest.map(e =>
      `- [${e.severity}] ${[e.country, e.region].filter(Boolean).join(' ')}: ${e.eventType ?? ''} ${e.description ? `— ${e.description.slice(0, 80)}` : ''}`
    ).join('\n')}`,

    milFlights.length > 0 && `## 軍用機 (HIGH リスク)\n${milFlights.map(f =>
      `- ${f.callsign ?? '?'} (${f.operator ?? f.country ?? '?'}): ${f.aircraft?.type ?? ''} alt:${f.altitude ?? '?'}ft`
    ).join('\n')}`,

    natural.length > 0 && `## 自然災害\n${natural.map(e =>
      `- [${e.category}] ${e.title}: ${(e.description ?? '').slice(0, 80)}`
    ).join('\n')}`,

    weather.length > 0 && `## 気象警報 (EXTREME/SEVERE)\n${weather.map(a =>
      `- [${a.severity}] ${a.event}: ${a.area ?? ''}`
    ).join('\n')}`,

    cyber.length > 0 && `## サイバー脅威 (CRITICAL)\n${cyber.map(t =>
      `- [${t.threatType}] ${t.indicator} (${t.country ?? '?'}): ${(t.description ?? '').slice(0, 60)}`
    ).join('\n')}`,

    conflicts.length > 0 && `## 武力紛争\n${conflicts.map(e =>
      `- ${e.country ?? ''}: ${(e.description ?? JSON.stringify(e)).slice(0, 80)}`
    ).join('\n')}`,

    topMovers.length > 0 && `## 市場動向 (変動率±2%以上)\n${topMovers.map(s => {
      const pct = s.changePercent ?? 0;
      return `- ${s.symbol ?? s.ticker ?? '?'} ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
    }).join('\n')}`,
  ].filter(Boolean).join('\n\n');

  if (!sections) {
    return LANGUAGE === 'ja'
      ? '現時点で重大なイベントは検出されていません。'
      : 'No significant events detected at this time.';
  }

  const prompt = `
あなたは世界情勢を監視するインテリジェンスアナリストです。
以下のリアルタイムデータを分析し、Discord 通知用の簡潔な状況報告を作成してください。

要件:
- 最も重要な事象を3〜5点に絞る
- 各事象は1〜2文で説明する
- 全体の脅威レベルを「低・中・高・緊急」で評価する
- 合計200〜300文字程度にまとめる
- ${langInstr}

現在のデータ:
${sections}

出力形式:
【脅威レベル: X】
• (重要事象1)
• (重要事象2)
• ...
`.trim();

  const result = await callGeminiDirect(prompt) ?? await callGeminiViaOpenRouter(prompt);
  return result ?? (LANGUAGE === 'ja'
    ? 'AI 要約を取得できませんでした。各データをダッシュボードでご確認ください。'
    : 'AI summary unavailable. Please check the dashboard for raw data.');
}

// ─── Discord 投稿 ─────────────────────────────────────────────────────────────

function buildEmbed(summary, worldData) {
  const { quakes, unrest, milFlights, natural, weather, cyber, topMovers, conflicts } = worldData;

  const levelMatch = summary.match(/【脅威レベル[：:]\s*(緊急|高|中|低|CRITICAL|HIGH|MEDIUM|LOW)/i);
  const level = (levelMatch?.[1] ?? '').toLowerCase();
  const color = ['緊急', 'critical'].some(s => level.includes(s)) ? COLOR.ALERT
    : ['高', 'high'].some(s => level.includes(s))    ? COLOR.WARNING
    : ['中', 'medium'].some(s => level.includes(s))  ? COLOR.INFO
    : COLOR.OK;

  const fields = [];

  if (quakes.length > 0) {
    fields.push({
      name: '🌊 地震 (M5.0+)',
      value: quakes.map(q => `M**${q.magnitude}** ${q.place ?? ''}`).join('\n').slice(0, 1024),
      inline: true,
    });
  }
  if (unrest.length > 0) {
    fields.push({
      name: '✊ 社会不安',
      value: unrest.map(e => `${e.country ?? ''} — ${e.eventType ?? e.severity}`).join('\n').slice(0, 1024),
      inline: true,
    });
  }
  if (milFlights.length > 0) {
    fields.push({
      name: '✈️ 軍用機 (HIGH)',
      value: milFlights.map(f => `${f.callsign ?? '?'} (${f.operator ?? f.country ?? '?'})`).join('\n').slice(0, 1024),
      inline: true,
    });
  }
  if (natural.length > 0) {
    fields.push({
      name: '🌋 自然災害',
      value: natural.map(e => e.title).join('\n').slice(0, 1024),
      inline: true,
    });
  }
  if (weather.length > 0) {
    fields.push({
      name: '⛈️ 気象警報',
      value: weather.map(a => `${a.event} — ${a.area ?? ''}`).join('\n').slice(0, 1024),
      inline: true,
    });
  }
  if (cyber.length > 0) {
    fields.push({
      name: '🔴 サイバー脅威',
      value: cyber.map(t => `${t.threatType}: ${t.indicator}`).join('\n').slice(0, 1024),
      inline: true,
    });
  }
  if (conflicts.length > 0) {
    const countryList = [...new Set(conflicts.map(e => e.country).filter(Boolean))].join(', ');
    fields.push({
      name: '⚔️ 武力紛争',
      value: (countryList || '詳細はダッシュボードで確認').slice(0, 1024),
      inline: true,
    });
  }
  if (topMovers.length > 0) {
    fields.push({
      name: '📈 市場動向',
      value: topMovers.map(s => {
        const pct = s.changePercent ?? 0;
        return `${pct >= 0 ? '▲' : '▼'} ${s.symbol ?? s.ticker ?? '?'} ${Math.abs(pct).toFixed(2)}%`;
      }).join('\n').slice(0, 1024),
      inline: true,
    });
  }

  const totalEvents = quakes.length + unrest.length + milFlights.length +
    natural.length + weather.length + cyber.length + conflicts.length;

  return {
    title: '🌍 World Monitor — グローバル状況レポート',
    description: summary,
    color,
    fields,
    footer: { text: `${totalEvents} 件検出 • ${GEMINI_MODEL} • World Monitor` },
    timestamp: new Date().toISOString(),
  };
}

async function postToDiscord(embed) {
  if (!DISCORD_WEBHOOK_URL) {
    console.error('[discord-notify] DISCORD_WEBHOOK_URL が設定されていません');
    return false;
  }
  try {
    const resp = await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        username: 'World Monitor',
        embeds: [embed],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error(`[discord-notify] Discord HTTP ${resp.status}: ${text.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error(`[discord-notify] Discord error: ${err.message}`);
    return false;
  }
}

// ─── メイン ───────────────────────────────────────────────────────────────────

function validateEnv({ exitOnMissing = true } = {}) {
  const missing = [];
  if (!DISCORD_WEBHOOK_URL) missing.push('DISCORD_WEBHOOK_URL');
  if (!GEMINI_API_KEY && !OPENROUTER_API_KEY) missing.push('GEMINI_API_KEY (または OPENROUTER_API_KEY)');
  if (missing.length > 0) {
    console.warn(`[discord-notify] 必須環境変数が未設定: ${missing.join(', ')} — 通知をスキップします`);
    if (exitOnMissing) process.exit(0);  // 0 = supervisord に再起動させない
    return false;
  }
  return true;
}

async function runOnce() {
  const start = Date.now();
  console.log(`[discord-notify] ${new Date().toISOString()} 実行開始`);

  const worldData = await fetchWorldData();
  const totalEvents = Object.values(worldData).flat().length;
  console.log(`[discord-notify] データ取得完了 (計 ${totalEvents} 件)`);

  const summary = await summarizeWithGemini(worldData);
  console.log(`[discord-notify] Gemini 要約完了 (${summary.length} 文字)`);

  const embed = buildEmbed(summary, worldData);
  const ok = await postToDiscord(embed);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[discord-notify] ${ok ? '✓ 投稿成功' : '✗ 投稿失敗'} (${elapsed}s)`);
}

async function runDaemon() {
  console.log(`[discord-notify] デーモン開始 — ${INTERVAL_MIN} 分ごとに通知`);
  // 未設定なら終了コード 0 で終了 (supervisord が再起動しない)
  validateEnv({ exitOnMissing: true });
  await runOnce();
  setInterval(async () => {
    try { await runOnce(); } catch (err) { console.error(`[discord-notify] エラー: ${err.message}`); }
  }, INTERVAL_MIN * 60 * 1000);
}

if (IS_DAEMON) {
  runDaemon().catch(err => { console.error(err); process.exit(1); });
} else {
  // cron 実行: 未設定なら SKIP (exit 0)
  if (validateEnv({ exitOnMissing: false })) {
    runOnce().catch(err => { console.error(err); process.exit(1); });
  }
}
