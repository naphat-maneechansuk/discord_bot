import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getQueue } from '../lib/queue-manager.js';
import { resolveTrack, searchTracks } from '../lib/track.js';
import {
  nowPlayingEmbed,
  queuedEmbed,
  nowPlayingComponents,
  searchResultsEmbed,
  searchResultsSelect,
} from '../lib/embeds.js';

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
  const isUrl = /^https?:\/\//i.test(query);

  if (!isUrl) {
    let results;
    try {
      results = await searchTracks(query, 5);
    } catch (err) {
      return interaction.followUp(`Search failed: ${err.message}`);
    }
    if (!results.length) return interaction.followUp(`No results for "${query}".`);
    return interaction.followUp({
      embeds: [searchResultsEmbed(query, results)],
      components: [searchResultsSelect(results)],
    });
  }

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
    await queue.retireNowPlayingMessage();
    const reply = await interaction.followUp({
      embeds: [nowPlayingEmbed(track, { queue, progressSeconds: 0 })],
      components: nowPlayingComponents(queue),
    });
    queue.nowPlayingMessage = reply;
    return reply;
  }
  await queue.refreshNowPlayingMessage();
  return interaction.followUp({ embeds: [queuedEmbed(track, queue.tracks.length)] });
}
