#!/usr/bin/env node

export const DISCORD_SLASH_COMMANDS = [
  {
    name: 'help',
    description: 'World Monitor の使い方とコマンド一覧を表示します',
  },
  {
    name: 'status',
    description: 'self-hosted インスタンスの基本状態を表示します',
  },
  {
    name: 'health',
    description: '現在の health 判定を表示します',
  },
  {
    name: 'latest',
    description: '最新の重要シグナルを短く要約します',
  },
];

export function formatSlashCommandLines() {
  return DISCORD_SLASH_COMMANDS.map((command) => `\`/${command.name}\` ${command.description}`);
}
