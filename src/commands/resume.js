import { SlashCommandBuilder } from 'discord.js';
import { peekQueue } from '../lib/queue-manager.js';

export const data = new SlashCommandBuilder().setName('resume').setDescription('Resume playback');

export async function execute(interaction) {
  const q = peekQueue(interaction.guildId);
  if (!q?.current) return interaction.reply('Nothing playing.');
  const ok = q.resume();
  return interaction.reply(ok ? '▶ Resumed.' : 'Could not resume.');
}
