#!/usr/bin/env node

import { loadEnvFile } from './_seed-utils.mjs';
import {
  GUIDE_CHANNEL_ORDER,
  buildGuideEmbeds,
  normalizeGuideChannelName,
  resolveGuideWebhookUrl,
} from './discord-guide-content.mjs';

loadEnvFile(import.meta.url);

function parseArgs(argv) {
  const opts = {
    dryRun: false,
    channels: [],
    list: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--dry-run') {
      opts.dryRun = true;
      continue;
    }
    if (arg === '--list') {
      opts.list = true;
      continue;
    }
    if (arg === '--all') {
      opts.channels = [...GUIDE_CHANNEL_ORDER];
      continue;
    }
    if (arg === '--channel') {
      const next = argv[i + 1];
      if (!next) throw new Error('--channel requires a value');
      const channel = normalizeGuideChannelName(next);
      if (!channel) throw new Error(`Unknown channel: ${next}`);
      opts.channels.push(channel);
      i += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  if (opts.channels.length === 0 && !opts.list) {
    opts.channels = [...GUIDE_CHANNEL_ORDER];
  }
  return opts;
}

async function postEmbeds(webhookUrl, embeds) {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username: 'World Monitor Guides',
      embeds,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Discord HTTP ${response.status}: ${text.slice(0, 200)}`);
  }
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.list) {
    for (const channel of GUIDE_CHANNEL_ORDER) {
      const webhook = resolveGuideWebhookUrl(channel);
      console.log(`${channel}\t${webhook ? 'configured' : 'missing'}`);
    }
    return;
  }

  for (const channel of opts.channels) {
    const webhook = resolveGuideWebhookUrl(channel);
    const embeds = buildGuideEmbeds(channel);
    if (opts.dryRun) {
      console.log(JSON.stringify({
        channel,
        webhookConfigured: Boolean(webhook),
        embeds,
      }, null, 2));
      continue;
    }
    if (!webhook) {
      console.warn(`[discord-guide-posts] SKIP ${channel}: webhook not configured`);
      continue;
    }
    await postEmbeds(webhook, embeds);
    console.log(`[discord-guide-posts] POSTED ${channel}`);
  }
}

run().catch((error) => {
  console.error(`[discord-guide-posts] ${error.message}`);
  process.exit(1);
});
