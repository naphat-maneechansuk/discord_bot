import { SlashCommandBuilder } from 'discord.js';
import { peekQueue } from '../lib/queue-manager.js';
import { formatDuration } from '../lib/track.js';

export const data = new SlashCommandBuilder().setName('queue').setDescription('Show the current queue');

export async function execute(interaction) {
  const q = peekQueue(interaction.guildId);
  if (!q || (!q.current && q.tracks.length === 0)) {
    return interaction.reply('Queue is empty.');
  }
  const lines = [];
  if (q.current) {
    lines.push(`▶ **Now:** ${q.current.title} \`[${formatDuration(q.current.duration)}]\``);
  }
  if (q.tracks.length > 0) {
    lines.push('');
    lines.push('**Up next:**');
    q.tracks.slice(0, 15).forEach((t, i) => {
      lines.push(`${i + 1}. ${t.title} \`[${formatDuration(t.duration)}]\``);
    });
    if (q.tracks.length > 15) lines.push(`...and ${q.tracks.length - 15} more`);
  }
  return interaction.reply(lines.join('\n').slice(0, 1900));
}
