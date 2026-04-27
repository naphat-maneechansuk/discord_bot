import { SlashCommandBuilder } from 'discord.js';
import { peekQueue } from '../lib/queue-manager.js';

export const data = new SlashCommandBuilder().setName('pause').setDescription('Pause playback');

export async function execute(interaction) {
  const q = peekQueue(interaction.guildId);
  if (!q?.current) return interaction.reply('Nothing playing.');
  const ok = q.pause();
  return interaction.reply(ok ? '⏸ Paused.' : 'Could not pause.');
}
