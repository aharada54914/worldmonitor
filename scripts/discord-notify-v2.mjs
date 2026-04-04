#!/usr/bin/env node
/**
 * discord-notify-v2.mjs
 *
 * World Monitor → AI/heuristic → Discord digest
 *
 * Improvements over scripts/discord-notify.mjs:
 * - deterministic fallback summary when AI is unavailable
 * - structured provider diagnostics
 * - AI credentials are optional; Discord digest can still be posted from raw data
 */

import { pathToFileURL } from 'node:url';
import { loadEnvFile, getRedisCredentials } from './_seed-utils.mjs';

loadEnvFile(import.meta.url);

const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';
const LANGUAGE = (process.env.DISCORD_NOTIFY_LANGUAGE || 'ja').toLowerCase();
const INTERVAL_MIN = Math.max(1, parseInt(process.env.DISCORD_NOTIFY_INTERVAL_MINUTES || '360', 10));
const IS_DAEMON = process.argv.includes('--daemon');

const COLOR = {
  ALERT: 0xE74C3C,
  WARNING: 0xE67E22,
  INFO: 0x3498DB,
  OK: 0x2ECC71,
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function isRecent(ts, withinMs = ONE_DAY_MS, now = Date.now()) {
  if (!ts) return false;
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  return Number.isFinite(t) && (now - t) < withinMs;
}

async function redisGet(key) {
  let creds;
  try {
    creds = getRedisCredentials();
  } catch {
    return null;
  }
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

export async function fetchWorldData() {
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
    .filter((q) => q.magnitude >= 5.0 && isRecent(q.occurredAt))
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, 5);

  const unrest = (get(unrestRaw)?.events ?? [])
    .filter((e) => e.severity === 'HIGH' && isRecent(e.occurredAt))
    .slice(0, 5);

  const milFlights = (get(milRaw)?.flights ?? [])
    .filter((f) => f.riskLevel === 'HIGH')
    .slice(0, 5);

  const natural = (get(naturalRaw)?.events ?? [])
    .filter((e) => !e.closed && ['VOLCANOES', 'SEVERE_STORMS', 'FLOODS', 'WILDFIRES'].includes(e.category))
    .sort((a, b) => Date.parse(b.date || 0) - Date.parse(a.date || 0))
    .slice(0, 5);

  const weather = (get(weatherRaw)?.alerts ?? [])
    .filter((a) => ['EXTREME', 'SEVERE'].includes(a.severity))
    .slice(0, 5);

  const cyber = (get(cyberRaw)?.threats ?? [])
    .filter((t) => t.severity === 'CRITICAL' && isRecent(t.firstSeen))
    .slice(0, 5);

  const stocks = get(marketRaw)?.stocks ?? get(marketRaw)?.quotes ?? [];
  const topMovers = [...stocks]
    .filter((s) => typeof s.changePercent === 'number' && Math.abs(s.changePercent) >= 2)
    .sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent))
    .slice(0, 5);

  const conflicts = (get(conflictRaw)?.events ?? [])
    .filter((e) => isRecent(e.date ?? e.occurredAt, 7 * ONE_DAY_MS))
    .slice(0, 5);

  return { quakes, unrest, milFlights, natural, weather, cyber, topMovers, conflicts };
}

function summarizeCounts(worldData) {
  return Object.values(worldData).reduce((sum, entries) => sum + entries.length, 0);
}

function buildPrompt(worldData, language) {
  const { quakes, unrest, milFlights, natural, weather, cyber, topMovers, conflicts } = worldData;
  const langInstr = language === 'ja'
    ? '日本語で、簡潔かつ具体的に回答してください。'
    : 'Answer concisely and specifically in English.';

  const sections = [
    quakes.length > 0 && `## Earthquakes\n${quakes.map((q) =>
      `- M${q.magnitude} ${q.place ?? (q.location ? `${q.location.latitude?.toFixed(1)}, ${q.location.longitude?.toFixed(1)}` : '')}`
    ).join('\n')}`,
    unrest.length > 0 && `## Unrest\n${unrest.map((e) =>
      `- [${e.severity}] ${[e.country, e.region].filter(Boolean).join(' ')}: ${e.eventType ?? ''} ${e.description ? `— ${String(e.description).slice(0, 80)}` : ''}`
    ).join('\n')}`,
    milFlights.length > 0 && `## Military flights\n${milFlights.map((f) =>
      `- ${f.callsign ?? '?'} (${f.operator ?? f.country ?? '?'}) ${f.aircraft?.type ?? ''}`
    ).join('\n')}`,
    natural.length > 0 && `## Natural hazards\n${natural.map((e) =>
      `- [${e.category}] ${e.title}: ${String(e.description ?? '').slice(0, 80)}`
    ).join('\n')}`,
    weather.length > 0 && `## Weather alerts\n${weather.map((a) =>
      `- [${a.severity}] ${a.event}: ${a.area ?? ''}`
    ).join('\n')}`,
    cyber.length > 0 && `## Cyber threats\n${cyber.map((t) =>
      `- [${t.threatType}] ${t.indicator} (${t.country ?? '?'})`
    ).join('\n')}`,
    conflicts.length > 0 && `## Conflicts\n${conflicts.map((e) =>
      `- ${e.country ?? ''}: ${String(e.description ?? JSON.stringify(e)).slice(0, 80)}`
    ).join('\n')}`,
    topMovers.length > 0 && `## Markets\n${topMovers.map((s) => {
      const pct = s.changePercent ?? 0;
      return `- ${s.symbol ?? s.ticker ?? '?'} ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`;
    }).join('\n')}`,
  ].filter(Boolean).join('\n\n');

  return `
You are an intelligence analyst writing a Discord digest for World Monitor.

Requirements:
- Select the 3 to 5 most important developments.
- Use short bullets.
- Start with a threat rating line.
- Keep it compact.
- ${langInstr}

Data:
${sections || '(no major events found)'}

Output format:
【脅威レベル: X】
• item 1
• item 2
• item 3
`.trim();
}

function classifyProviderFailure(provider, resp, bodyText = '') {
  if (resp?.status === 404 || resp?.status === 400) {
    return 'AI_MODEL_NOT_FOUND';
  }
  if (resp?.status === 401 || resp?.status === 403) {
    return 'AI_PROVIDER_ERROR';
  }
  if (resp?.status === 408 || resp?.status === 429) {
    return 'AI_RATE_LIMITED';
  }
  if (resp?.status >= 500) {
    return 'AI_PROVIDER_ERROR';
  }
  if (/model.+not found/i.test(bodyText)) return 'AI_MODEL_NOT_FOUND';
  if (/rate limit|quota|429/i.test(bodyText)) return 'AI_RATE_LIMITED';
  return 'AI_PROVIDER_ERROR';
}

async function callGeminiDirect(prompt) {
  if (!GEMINI_API_KEY) {
    return { ok: false, code: 'AI_DISABLED', provider: 'gemini-direct', model: GEMINI_MODEL, detail: 'GEMINI_API_KEY missing' };
  }
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
      const bodyText = await resp.text().catch(() => '');
      return {
        ok: false,
        code: classifyProviderFailure('gemini-direct', resp, bodyText),
        provider: 'gemini-direct',
        model: GEMINI_MODEL,
        httpStatus: resp.status,
        detail: bodyText.slice(0, 200),
      };
    }
    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    if (!text) {
      return { ok: false, code: 'AI_EMPTY_INPUT', provider: 'gemini-direct', model: GEMINI_MODEL, detail: 'empty candidate text' };
    }
    return { ok: true, text, provider: 'gemini-direct', model: GEMINI_MODEL };
  } catch (error) {
    return { ok: false, code: 'AI_PROVIDER_ERROR', provider: 'gemini-direct', model: GEMINI_MODEL, detail: error.message };
  }
}

async function callGeminiViaOpenRouter(prompt) {
  if (!OPENROUTER_API_KEY) {
    return { ok: false, code: 'AI_DISABLED', provider: 'openrouter', model: OPENROUTER_MODEL, detail: 'OPENROUTER_API_KEY missing' };
  }
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://worldmonitor.app',
        'X-Title': 'World Monitor',
      },
      body: JSON.stringify({
        model: OPENROUTER_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.4,
        max_tokens: 1200,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!resp.ok) {
      const bodyText = await resp.text().catch(() => '');
      return {
        ok: false,
        code: classifyProviderFailure('openrouter', resp, bodyText),
        provider: 'openrouter',
        model: OPENROUTER_MODEL,
        httpStatus: resp.status,
        detail: bodyText.slice(0, 200),
      };
    }
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      return { ok: false, code: 'AI_EMPTY_INPUT', provider: 'openrouter', model: OPENROUTER_MODEL, detail: 'empty choice content' };
    }
    return { ok: true, text, provider: 'openrouter', model: OPENROUTER_MODEL };
  } catch (error) {
    return { ok: false, code: 'AI_PROVIDER_ERROR', provider: 'openrouter', model: OPENROUTER_MODEL, detail: error.message };
  }
}

export function determineThreatLevel(worldData, language = LANGUAGE) {
  const { quakes, unrest, milFlights, weather, cyber, conflicts } = worldData;
  if (cyber.length > 0 || milFlights.length >= 3 || conflicts.length >= 3) return language === 'ja' ? '高' : 'HIGH';
  if (quakes.some((q) => q.magnitude >= 6.5) || weather.length >= 2 || unrest.length >= 3) return language === 'ja' ? '中' : 'MEDIUM';
  if (summarizeCounts(worldData) > 0) return language === 'ja' ? '低' : 'LOW';
  return language === 'ja' ? '低' : 'LOW';
}

function formatPlace(value, fallback = '') {
  return value && String(value).trim() ? String(value).trim() : fallback;
}

export function buildFallbackSummary(worldData, language = LANGUAGE) {
  const bullets = [];
  const level = determineThreatLevel(worldData, language);

  if (worldData.quakes[0]) {
    const q = worldData.quakes[0];
    bullets.push(language === 'ja'
      ? `M${q.magnitude}の地震が${formatPlace(q.place, '観測地点不明')}で観測されました。`
      : `An M${q.magnitude} earthquake was recorded near ${formatPlace(q.place, 'an unspecified location')}.`);
  }
  if (worldData.cyber[0]) {
    const t = worldData.cyber[0];
    bullets.push(language === 'ja'
      ? `重大サイバー脅威として${t.threatType ?? 'unknown'}が検出されています。`
      : `A critical cyber threat was detected: ${t.threatType ?? 'unknown'}.`);
  }
  if (worldData.weather[0]) {
    const a = worldData.weather[0];
    bullets.push(language === 'ja'
      ? `${a.event ?? '気象警報'}が${formatPlace(a.area, '対象地域不明')}に出ています。`
      : `${a.event ?? 'A severe weather alert'} is active for ${formatPlace(a.area, 'an unspecified area')}.`);
  }
  if (worldData.unrest[0]) {
    const e = worldData.unrest[0];
    bullets.push(language === 'ja'
      ? `${formatPlace(e.country, '不明地域')}で社会不安イベントが報告されています。`
      : `Civil unrest activity was reported in ${formatPlace(e.country, 'an unspecified location')}.`);
  }
  if (worldData.topMovers[0]) {
    const s = worldData.topMovers[0];
    const pct = s.changePercent ?? 0;
    bullets.push(language === 'ja'
      ? `市場では${s.symbol ?? s.ticker ?? '?'}が${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%変動しました。`
      : `Markets saw ${s.symbol ?? s.ticker ?? '?'} move ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%.`);
  }
  if (bullets.length === 0) {
    bullets.push(language === 'ja'
      ? '重大イベントは検出されませんでした。ダッシュボードの生データを継続監視してください。'
      : 'No major events were detected. Continue monitoring the raw dashboard data.');
  }

  const header = language === 'ja' ? `【脅威レベル: ${level}】` : `[Threat level: ${level}]`;
  return `${header}\n${bullets.slice(0, 4).map((item) => `• ${item}`).join('\n')}`;
}

export async function summarizeWorldData(worldData, language = LANGUAGE) {
  const prompt = buildPrompt(worldData, language);
  const attempts = [
    await callGeminiDirect(prompt),
    await callGeminiViaOpenRouter(prompt),
  ];

  const success = attempts.find((result) => result?.ok);
  if (success) return success;

  const primaryFailure = attempts.find((result) => result && result.code !== 'AI_DISABLED')
    ?? attempts[0]
    ?? { ok: false, code: 'AI_DISABLED', provider: 'none', model: 'none', detail: 'No providers configured' };

  return {
    ok: true,
    text: buildFallbackSummary(worldData, language),
    provider: 'heuristic-fallback',
    model: primaryFailure.code,
    fallbackFrom: primaryFailure,
  };
}

function chooseColor(summaryText) {
  const lowered = String(summaryText).toLowerCase();
  if (lowered.includes('緊急') || lowered.includes('critical') || lowered.includes('threat level: critical')) return COLOR.ALERT;
  if (lowered.includes('高') || lowered.includes('high')) return COLOR.WARNING;
  if (lowered.includes('中') || lowered.includes('medium')) return COLOR.INFO;
  return COLOR.OK;
}

export function buildEmbed(summaryResult, worldData, language = LANGUAGE) {
  const { quakes, unrest, milFlights, natural, weather, cyber, topMovers, conflicts } = worldData;
  const summary = summaryResult.text;
  const fields = [];

  if (quakes.length > 0) {
    fields.push({
      name: language === 'ja' ? '🌊 地震 (M5.0+)' : '🌊 Earthquakes (M5.0+)',
      value: quakes.map((q) => `M**${q.magnitude}** ${q.place ?? ''}`).join('\n').slice(0, 1024),
      inline: true,
    });
  }
  if (unrest.length > 0) {
    fields.push({
      name: language === 'ja' ? '✊ 社会不安' : '✊ Unrest',
      value: unrest.map((e) => `${e.country ?? ''} — ${e.eventType ?? e.severity}`).join('\n').slice(0, 1024),
      inline: true,
    });
  }
  if (milFlights.length > 0) {
    fields.push({
      name: language === 'ja' ? '✈️ 軍用機 (HIGH)' : '✈️ Military flights (HIGH)',
      value: milFlights.map((f) => `${f.callsign ?? '?'} (${f.operator ?? f.country ?? '?'})`).join('\n').slice(0, 1024),
      inline: true,
    });
  }
  if (natural.length > 0) {
    fields.push({
      name: language === 'ja' ? '🌋 自然災害' : '🌋 Natural hazards',
      value: natural.map((e) => e.title).join('\n').slice(0, 1024),
      inline: true,
    });
  }
  if (weather.length > 0) {
    fields.push({
      name: language === 'ja' ? '⛈️ 気象警報' : '⛈️ Weather alerts',
      value: weather.map((a) => `${a.event} — ${a.area ?? ''}`).join('\n').slice(0, 1024),
      inline: true,
    });
  }
  if (cyber.length > 0) {
    fields.push({
      name: language === 'ja' ? '🔴 サイバー脅威' : '🔴 Cyber threats',
      value: cyber.map((t) => `${t.threatType}: ${t.indicator}`).join('\n').slice(0, 1024),
      inline: true,
    });
  }
  if (conflicts.length > 0) {
    const countryList = [...new Set(conflicts.map((e) => e.country).filter(Boolean))].join(', ');
    fields.push({
      name: language === 'ja' ? '⚔️ 武力紛争' : '⚔️ Conflicts',
      value: (countryList || (language === 'ja' ? '詳細はダッシュボードで確認' : 'See dashboard for details')).slice(0, 1024),
      inline: true,
    });
  }
  if (topMovers.length > 0) {
    fields.push({
      name: language === 'ja' ? '📈 市場動向' : '📈 Markets',
      value: topMovers.map((s) => {
        const pct = s.changePercent ?? 0;
        return `${pct >= 0 ? '▲' : '▼'} ${s.symbol ?? s.ticker ?? '?'} ${Math.abs(pct).toFixed(2)}%`;
      }).join('\n').slice(0, 1024),
      inline: true,
    });
  }

  const totalEvents = summarizeCounts(worldData);
  const footerBits = [`${totalEvents} ${language === 'ja' ? '件検出' : 'items'}`];
  if (summaryResult.provider === 'heuristic-fallback') {
    footerBits.push(`fallback:${summaryResult.fallbackFrom?.code ?? 'AI_DISABLED'}`);
  } else {
    footerBits.push(`${summaryResult.provider}`);
    footerBits.push(`${summaryResult.model}`);
  }

  return {
    title: language === 'ja' ? '🌍 World Monitor — グローバル状況レポート' : '🌍 World Monitor — Global Situation Report',
    description: summary,
    color: chooseColor(summary),
    fields,
    footer: { text: footerBits.join(' • ') },
    timestamp: new Date().toISOString(),
  };
}

async function postToDiscord(embed) {
  if (!DISCORD_WEBHOOK_URL) {
    console.error('[discord-notify-v2] DISCORD_WEBHOOK_URL is not configured');
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
      console.error(`[discord-notify-v2] Discord HTTP ${resp.status}: ${text.slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[discord-notify-v2] Discord error: ${error.message}`);
    return false;
  }
}

function validateEnv({ exitOnMissing = true } = {}) {
  if (DISCORD_WEBHOOK_URL) return true;
  console.warn('[discord-notify-v2] DISCORD_WEBHOOK_URL missing — skipping digest');
  if (exitOnMissing) process.exit(0);
  return false;
}

export async function runOnce() {
  const start = Date.now();
  console.log(`[discord-notify-v2] ${new Date().toISOString()} start`);

  const worldData = await fetchWorldData();
  const totalEvents = summarizeCounts(worldData);
  console.log(`[discord-notify-v2] fetched ${totalEvents} items`);

  const summaryResult = await summarizeWorldData(worldData, LANGUAGE);
  if (summaryResult.provider === 'heuristic-fallback') {
    console.warn(`[discord-notify-v2] AI fallback engaged: ${summaryResult.fallbackFrom?.code ?? 'AI_DISABLED'} (${summaryResult.fallbackFrom?.provider ?? 'none'})`);
  } else {
    console.log(`[discord-notify-v2] AI summary provider=${summaryResult.provider} model=${summaryResult.model}`);
  }

  const embed = buildEmbed(summaryResult, worldData, LANGUAGE);
  const ok = await postToDiscord(embed);
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`[discord-notify-v2] ${ok ? 'posted' : 'failed'} (${elapsed}s)`);
}

async function runDaemon() {
  console.log(`[discord-notify-v2] daemon mode every ${INTERVAL_MIN} minutes`);
  validateEnv({ exitOnMissing: true });
  await runOnce();
  setInterval(async () => {
    try {
      await runOnce();
    } catch (error) {
      console.error(`[discord-notify-v2] ${error.message}`);
    }
  }, INTERVAL_MIN * 60 * 1000);
}

function isMainModule() {
  if (!process.argv[1]) return false;
  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  if (IS_DAEMON) {
    runDaemon().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  } else if (validateEnv({ exitOnMissing: false })) {
    runOnce().catch((error) => {
      console.error(error);
      process.exit(1);
    });
  }
}
