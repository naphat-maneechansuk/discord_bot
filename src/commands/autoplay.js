import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { peekQueue } from '../lib/queue-manager.js';

export const data = new SlashCommandBuilder()
  .setName('autoplay')
  .setDescription('Keep the music going with related songs when the queue runs out')
  .addStringOption((opt) =>
    opt
      .setName('mode')
      .setDescription('Turn radio mode on or off')
      .setRequired(true)
      .addChoices(
        { name: 'on', value: 'on' },
        { name: 'off', value: 'off' },
      ),
  );

export async function execute(interaction) {
  const q = peekQueue(interaction.guildId);
  if (!q) {
    return interaction.reply({
      content: 'Nothing playing. Play a song first, then turn on autoplay.',
      flags: MessageFlags.Ephemeral,
    });
  }
  const on = interaction.options.getString('mode', true) === 'on';
  q.setAutoplay(on);
  await q.refreshNowPlayingMessage();
  return interaction.reply({
    content: on
      ? '📻 Autoplay on — I’ll keep adding related songs when the queue empties.'
      : '⏹ Autoplay off — I’ll stop once the queue runs out.',
    flags: MessageFlags.Ephemeral,
  });
}
