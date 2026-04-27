import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { peekQueue } from '../lib/queue-manager.js';

export const data = new SlashCommandBuilder()
  .setName('loop')
  .setDescription('Set loop mode')
  .addStringOption((opt) =>
    opt
      .setName('mode')
      .setDescription('off, track (repeat current), or queue (repeat all)')
      .setRequired(true)
      .addChoices(
        { name: 'off', value: 'off' },
        { name: 'track', value: 'track' },
        { name: 'queue', value: 'queue' },
      ),
  );

export async function execute(interaction) {
  const q = peekQueue(interaction.guildId);
  if (!q) return interaction.reply({ content: 'Nothing playing.', flags: MessageFlags.Ephemeral });
  const mode = interaction.options.getString('mode', true);
  q.setLoopMode(mode);
  const label = mode === 'off' ? '➡ Loop off' : mode === 'track' ? '🔂 Looping current track' : '🔁 Looping queue';
  return interaction.reply({ content: label, flags: MessageFlags.Ephemeral });
}
