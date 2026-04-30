import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { peekQueue } from '../lib/queue-manager.js';

export const data = new SlashCommandBuilder()
  .setName('jump')
  .setDescription('Jump to a specific track in the queue by its number')
  .addIntegerOption((opt) =>
    opt
      .setName('position')
      .setDescription('Track number in the queue (1 = next up)')
      .setRequired(true)
      .setMinValue(1),
  );

export async function execute(interaction) {
  const q = peekQueue(interaction.guildId);
  if (!q?.current) {
    return interaction.reply({ content: 'Nothing playing.', flags: MessageFlags.Ephemeral });
  }
  const pos = interaction.options.getInteger('position', true);
  const idx = pos - 1;
  const target = q.tracks[idx];
  if (!target) {
    return interaction.reply({
      content: `Queue only has ${q.tracks.length} track(s).`,
      flags: MessageFlags.Ephemeral,
    });
  }
  if (!q.jumpTo(idx)) {
    return interaction.reply({ content: 'Jump failed.', flags: MessageFlags.Ephemeral });
  }
  return interaction.reply(`⏭ Jumped to **#${pos}: ${target.title}**`);
}
