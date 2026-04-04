import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildFallbackSummary,
  buildEmbed,
  determineThreatLevel,
} from '../scripts/discord-notify-v2.mjs';

function sampleWorldData() {
  return {
    quakes: [{ magnitude: 6.1, place: '130 km WNW of Ternate, Indonesia' }],
    unrest: [],
    milFlights: [],
    natural: [],
    weather: [{ severity: 'SEVERE', event: 'Typhoon warning', area: 'Okinawa' }],
    cyber: [],
    topMovers: [{ symbol: 'BRENT', changePercent: 3.4 }],
    conflicts: [],
  };
}

test('fallback summary stays user-facing when AI is unavailable', () => {
  const text = buildFallbackSummary(sampleWorldData(), 'ja');
  assert.match(text, /脅威レベル/);
  assert.doesNotMatch(text, /AI 要約を取得できませんでした/);
  assert.match(text, /地震|気象警報|市場/);
});

test('threat level classifier remains deterministic for medium event mix', () => {
  assert.equal(determineThreatLevel(sampleWorldData(), 'ja'), 'LOW');
  assert.equal(determineThreatLevel(sampleWorldData(), 'en'), 'LOW');
});

test('embed footer exposes fallback diagnostic code instead of raw provider error text', () => {
  const embed = buildEmbed({
    ok: true,
    text: buildFallbackSummary(sampleWorldData(), 'ja'),
    provider: 'heuristic-fallback',
    model: 'AI_RATE_LIMITED',
    fallbackFrom: { code: 'AI_RATE_LIMITED', provider: 'openrouter' },
  }, sampleWorldData(), 'ja');

  assert.match(embed.footer.text, /fallback:AI_RATE_LIMITED/);
  assert.doesNotMatch(embed.description, /AI 要約を取得できませんでした/);
});
