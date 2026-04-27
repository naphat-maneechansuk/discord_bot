import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { peekQueue } from '../lib/queue-manager.js';
import { queueListEmbed } from '../lib/embeds.js';

export const data = new SlashCommandBuilder().setName('queue').setDescription('Show the current queue');

export async function execute(interaction) {
  const q = peekQueue(interaction.guildId);
  if (!q || (!q.current && q.tracks.length === 0)) {
    return interaction.reply({ content: 'Queue is empty.', flags: MessageFlags.Ephemeral });
  }
  return interaction.reply({ embeds: [queueListEmbed(q)], flags: MessageFlags.Ephemeral });
}
