import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { peekQueue } from '../lib/queue-manager.js';
import { notify } from '../lib/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('shuffle')
  .setDescription('Toggle shuffle mode');

export async function execute(interaction) {
  const q = peekQueue(interaction.guildId);
  if (!q) return interaction.reply({ content: 'Nothing playing.', flags: MessageFlags.Ephemeral });
  const on = q.toggleShuffle();
  await q.refreshNowPlayingMessage();
  return interaction.reply({
    embeds: [notify('shuffle', `Shuffle ${on ? 'on' : 'off'}`)],
    flags: MessageFlags.Ephemeral,
  });
}
