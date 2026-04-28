import { SlashCommandBuilder } from 'discord.js';
import { peekQueue } from '../lib/queue-manager.js';

export const data = new SlashCommandBuilder()
  .setName('stop')
  .setDescription('Stop playback, clear queue, and leave voice channel');

export async function execute(interaction) {
  const q = peekQueue(interaction.guildId);
  if (!q) return interaction.reply('Not in a voice channel.');
  await q.retireNowPlayingMessage();
  q.stop();
  return interaction.reply('⏹ Stopped and disconnected.');
}
