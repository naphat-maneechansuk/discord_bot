import { SlashCommandBuilder } from 'discord.js';
import { peekQueue } from '../lib/queue-manager.js';

export const data = new SlashCommandBuilder().setName('skip').setDescription('Skip the current track');

export async function execute(interaction) {
  const q = peekQueue(interaction.guildId);
  if (!q?.current) return interaction.reply('Nothing playing.');
  const skipped = q.current.title;
  q.skip();
  return interaction.reply(`⏭ Skipped: **${skipped}**`);
}
