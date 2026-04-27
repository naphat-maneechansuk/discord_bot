import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getQueue } from '../lib/queue-manager.js';
import { resolveTrack, formatDuration } from '../lib/track.js';

export const data = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Play a song or add to queue')
  .addStringOption((opt) =>
    opt.setName('query').setDescription('YouTube URL or search keywords').setRequired(true),
  );

export async function execute(interaction) {
  const query = interaction.options.getString('query', true);
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    return interaction.reply({
      content: 'Join a voice channel first.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply();

  let track;
  try {
    track = await resolveTrack(query, interaction.user.tag);
  } catch (err) {
    return interaction.followUp(`Failed to resolve track: ${err.message}`);
  }

  const queue = getQueue(interaction.guildId);
  queue.textChannel = interaction.channel;

  try {
    await queue.ensureConnection(voiceChannel);
  } catch (err) {
    return interaction.followUp(`Failed to join voice: ${err.message}`);
  }

  queue.enqueue(track);

  if (!queue.current) {
    await queue.start();
    return interaction.followUp(`🎵 Playing: **${track.title}** \`[${formatDuration(track.duration)}]\``);
  }
  return interaction.followUp(
    `➕ Added to queue (#${queue.tracks.length}): **${track.title}** \`[${formatDuration(track.duration)}]\``,
  );
}
