import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { peekQueue } from '../lib/queue-manager.js';

export const data = new SlashCommandBuilder()
  .setName('remove')
  .setDescription('Remove a track from the queue by position')
  .addIntegerOption((opt) =>
    opt.setName('position').setDescription('Queue position (see /queue)').setRequired(true).setMinValue(1),
  );

export async function execute(interaction) {
  const q = peekQueue(interaction.guildId);
  if (!q || q.tracks.length === 0) {
    return interaction.reply({ content: 'Queue is empty.', flags: MessageFlags.Ephemeral });
  }
  const position = interaction.options.getInteger('position', true);
  const removed = q.removeAt(position - 1);
  if (!removed) {
    return interaction.reply({
      content: `Position ${position} is out of range (queue has ${q.tracks.length} tracks).`,
      flags: MessageFlags.Ephemeral,
    });
  }
  await q.refreshNowPlayingMessage();
  return interaction.reply({ content: `🗑 Removed: **${removed.title}**`, flags: MessageFlags.Ephemeral });
}
