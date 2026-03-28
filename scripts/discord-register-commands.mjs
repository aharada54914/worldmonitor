#!/usr/bin/env node

import { loadEnvFile } from './_seed-utils.mjs';
import { DISCORD_SLASH_COMMANDS } from './discord-slash-commands.mjs';

loadEnvFile(import.meta.url);

function parseArgs(argv) {
  const options = {
    dryRun: false,
    guildId: String(process.env.DISCORD_GUILD_ID || '').trim(),
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--guild') {
      const value = argv[index + 1];
      if (!value) throw new Error('--guild requires an id');
      options.guildId = value.trim();
      index += 1;
      continue;
    }
    if (arg === '--global') {
      options.guildId = '';
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function getDiscordRegistrationConfig() {
  const applicationId = String(process.env.DISCORD_APPLICATION_ID || '').trim();
  const botToken = String(process.env.DISCORD_BOT_TOKEN || '').trim();
  if (!applicationId || !botToken) {
    throw new Error('Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN first');
  }
  return { applicationId, botToken };
}

function getRegistrationUrl(applicationId, guildId) {
  if (guildId) {
    return `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`;
  }
  return `https://discord.com/api/v10/applications/${applicationId}/commands`;
}

async function registerCommands(url, botToken) {
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: `Bot ${botToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(DISCORD_SLASH_COMMANDS),
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Discord HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  return text ? JSON.parse(text) : [];
}

async function run() {
  const options = parseArgs(process.argv.slice(2));
  const { applicationId, botToken } = getDiscordRegistrationConfig();
  const url = getRegistrationUrl(applicationId, options.guildId);

  if (options.dryRun) {
    console.log(JSON.stringify({
      scope: options.guildId ? 'guild' : 'global',
      guildId: options.guildId || null,
      url,
      commands: DISCORD_SLASH_COMMANDS,
    }, null, 2));
    return;
  }

  const result = await registerCommands(url, botToken);
  console.log(JSON.stringify({
    ok: true,
    scope: options.guildId ? 'guild' : 'global',
    guildId: options.guildId || null,
    registered: Array.isArray(result) ? result.length : 0,
  }));
}

run().catch((error) => {
  console.error(`[discord-register-commands] ${error.message}`);
  process.exit(1);
});
