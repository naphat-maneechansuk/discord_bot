import { SlashCommandBuilder } from 'discord.js';
import { useMainPlayer } from 'discord-player';

export const data = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Play a song from a URL or search query')
  .addStringOption((opt) =>
    opt.setName('query').setDescription('YouTube URL or search keywords').setRequired(true),
  );

export async function execute(interaction) {
  const query = interaction.options.getString('query', true);
  const channel = interaction.member?.voice?.channel;

  if (!channel) {
    return interaction.reply({ content: 'Join a voice channel first.', ephemeral: true });
  }

  await interaction.deferReply();

  const player = useMainPlayer();

  try {
    const { track } = await player.play(channel, query, {
      nodeOptions: {
        metadata: { channel: interaction.channel },
        leaveOnEmpty: true,
        leaveOnEmptyCooldown: 60_000,
        leaveOnEnd: true,
        leaveOnEndCooldown: 60_000,
      },
      requestedBy: interaction.user,
    });

    return interaction.followUp(`Now playing: **${track.title}**`);
  } catch (err) {
    console.error(err);
    return interaction.followUp(`Error: ${err.message}`);
  }
}
