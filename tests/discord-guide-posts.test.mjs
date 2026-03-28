import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GUIDE_CHANNEL_ORDER,
  buildGuideEmbeds,
  normalizeGuideChannelName,
  resolveGuideWebhookUrl,
} from '../scripts/discord-guide-content.mjs';

test('normalizeGuideChannelName resolves aliases', () => {
  assert.equal(normalizeGuideChannelName('usage'), 'how-to-use');
  assert.equal(normalizeGuideChannelName('HOW_TO_USE'), 'how-to-use');
  assert.equal(normalizeGuideChannelName('operations'), 'ops');
  assert.equal(normalizeGuideChannelName('unknown'), null);
});

test('resolveGuideWebhookUrl falls back to alert webhook for alerts only', () => {
  const env = {
    DISCORD_GUIDE_WEBHOOK_URL_DEFAULT: 'https://discord.example/default',
    DISCORD_WEBHOOK_URL: 'https://discord.example/alerts',
  };
  assert.equal(resolveGuideWebhookUrl('welcome', env), 'https://discord.example/default');
  assert.equal(resolveGuideWebhookUrl('alerts', { DISCORD_WEBHOOK_URL: env.DISCORD_WEBHOOK_URL }), env.DISCORD_WEBHOOK_URL);
});

test('commands embed lists supported slash commands', () => {
  const embeds = buildGuideEmbeds('commands');
  assert.equal(Array.isArray(embeds), true);
  assert.equal(embeds.length > 0, true);
  assert.match(embeds[0].description, /slash command に対応しました/);
  assert.match(embeds[0].fields[0].value, /`\/help`/);
});

test('guide channel order stays stable for bulk posting', () => {
  assert.deepEqual(GUIDE_CHANNEL_ORDER, ['welcome', 'how-to-use', 'commands', 'ops', 'alerts']);
});
