import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getQueue } from '../lib/queue-manager.js';
import { resolveTrack, resolvePlaylist, isPlaylistUrl, searchTracks } from '../lib/track.js';
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

  const queue = getQueue(interaction.guildId);
  queue.textChannel = interaction.channel;

  try {
    await queue.ensureConnection(voiceChannel);
  } catch (err) {
    return interaction.followUp(`Failed to join voice: ${err.message}`);
  }

  if (isPlaylistUrl(query)) {
    let tracks;
    try {
      tracks = await resolvePlaylist(query, interaction.user.tag);
    } catch (err) {
      return interaction.followUp(`Failed to load playlist: ${err.message}`);
    }
    if (!tracks.length) return interaction.followUp('Playlist is empty.');

    const startedEmpty = !queue.current;
    for (const t of tracks) queue.enqueue(t);

    if (startedEmpty) {
      await queue.start();
      await queue.retireNowPlayingMessage();
      await interaction.followUp(`📃 Loaded **${tracks.length}** tracks from playlist.`);
      const npMsg = await interaction.channel.send({
        embeds: [nowPlayingEmbed(queue.current, { queue, progressSeconds: 0 })],
        components: nowPlayingComponents(queue),
      });
      queue.nowPlayingMessage = npMsg;
      return;
    }
    await queue.refreshNowPlayingMessage();
    return interaction.followUp(`📃 Added **${tracks.length}** tracks to queue.`);
  }

  let track;
  try {
    track = await resolveTrack(query, interaction.user.tag);
  } catch (err) {
    return interaction.followUp(`Failed to resolve track: ${err.message}`);
  }

  queue.enqueue(track);

  if (!queue.current) {
    await queue.start();
    await queue.retireNowPlayingMessage();
    await interaction.followUp({ embeds: [queuedEmbed(track, 1)] });
    const npMsg = await interaction.channel.send({
      embeds: [nowPlayingEmbed(track, { queue, progressSeconds: 0 })],
      components: nowPlayingComponents(queue),
    });
    queue.nowPlayingMessage = npMsg;
    return;
  }
  await queue.refreshNowPlayingMessage();
  return interaction.followUp({ embeds: [queuedEmbed(track, queue.tracks.length)] });
}
