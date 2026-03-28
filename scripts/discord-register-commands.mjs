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
  const clientSecret = String(process.env.DISCORD_CLIENT_SECRET || '').trim();
  if (!applicationId) {
    throw new Error('Set DISCORD_APPLICATION_ID first');
  }
  if (!botToken && !clientSecret) {
    throw new Error('Set DISCORD_BOT_TOKEN or DISCORD_CLIENT_SECRET first');
  }
  return { applicationId, botToken, clientSecret };
}

function getRegistrationUrl(applicationId, guildId) {
  if (guildId) {
    return `https://discord.com/api/v10/applications/${applicationId}/guilds/${guildId}/commands`;
  }
  return `https://discord.com/api/v10/applications/${applicationId}/commands`;
}

async function fetchClientCredentialsToken(applicationId, clientSecret) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    scope: 'applications.commands.update',
  });
  const credentials = Buffer.from(`${applicationId}:${clientSecret}`).toString('base64');
  const response = await fetch('https://discord.com/api/v10/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Discord OAuth HTTP ${response.status}: ${text.slice(0, 300)}`);
  }
  const data = text ? JSON.parse(text) : {};
  const accessToken = String(data.access_token || '').trim();
  if (!accessToken) {
    throw new Error('Discord OAuth token response did not include access_token');
  }
  return accessToken;
}

async function getAuthorizationHeader(applicationId, botToken, clientSecret) {
  if (botToken) {
    return { value: `Bot ${botToken}`, mode: 'bot_token' };
  }
  const accessToken = await fetchClientCredentialsToken(applicationId, clientSecret);
  return { value: `Bearer ${accessToken}`, mode: 'client_credentials' };
}

async function registerCommands(url, authorizationHeader) {
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: authorizationHeader,
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
  const { applicationId, botToken, clientSecret } = getDiscordRegistrationConfig();
  const url = getRegistrationUrl(applicationId, options.guildId);

  if (options.dryRun) {
    console.log(JSON.stringify({
      scope: options.guildId ? 'guild' : 'global',
      guildId: options.guildId || null,
      url,
      authMode: botToken ? 'bot_token' : 'client_credentials',
      commands: DISCORD_SLASH_COMMANDS,
    }, null, 2));
    return;
  }

  const authorization = await getAuthorizationHeader(applicationId, botToken, clientSecret);
  const result = await registerCommands(url, authorization.value);
  console.log(JSON.stringify({
    ok: true,
    scope: options.guildId ? 'guild' : 'global',
    guildId: options.guildId || null,
    authMode: authorization.mode,
    registered: Array.isArray(result) ? result.length : 0,
  }));
}

run().catch((error) => {
  console.error(`[discord-register-commands] ${error.message}`);
  process.exit(1);
});
