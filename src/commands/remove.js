import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { peekQueue } from '../lib/queue-manager.js';
import { removeSelect } from '../lib/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('remove')
  .setDescription('Pick a track to remove from the queue');

export async function execute(interaction) {
  const q = peekQueue(interaction.guildId);
  if (!q || q.tracks.length === 0) {
    return interaction.reply({ content: 'Queue is empty.', flags: MessageFlags.Ephemeral });
  }
  return interaction.reply({
    content: 'Pick a track to remove from queue:',
    components: [removeSelect(q.tracks)],
    flags: MessageFlags.Ephemeral,
  });
}
