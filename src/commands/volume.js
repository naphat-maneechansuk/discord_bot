import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { peekQueue } from '../lib/queue-manager.js';
import { notify } from '../lib/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('volume')
  .setDescription('Set bot volume (0-100)')
  .addIntegerOption((opt) =>
    opt.setName('level').setDescription('0-100').setRequired(true).setMinValue(0).setMaxValue(100),
  );

export async function execute(interaction) {
  const q = peekQueue(interaction.guildId);
  if (!q) return interaction.reply({ content: 'Nothing playing.', flags: MessageFlags.Ephemeral });
  const level = interaction.options.getInteger('level', true);
  const v = q.setVolume(level / 100);
  await q.refreshNowPlayingMessage();
  return interaction.reply({
    embeds: [notify('volume', `Volume: ${Math.round(v * 100)}%`)],
    flags: MessageFlags.Ephemeral,
  });
}
