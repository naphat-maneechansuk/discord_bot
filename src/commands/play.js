import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getQueue, MAX_QUEUE } from '../lib/queue-manager.js';
import { resolveTrack, resolvePlaylist, isPlaylistUrl, searchTracks } from '../lib/track.js';
import {
  nowPlayingEmbed,
  queuedEmbed,
  nowPlayingComponents,
  searchResultsEmbed,
  searchResultsSelect,
  friendlyErrorEmbed,
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
      const card = friendlyErrorEmbed(err);
      if (card) return interaction.followUp({ embeds: [card] });
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
      const card = friendlyErrorEmbed(err);
      if (card) return interaction.followUp({ embeds: [card] });
      return interaction.followUp(`Failed to load playlist: ${err.message}`);
    }
    if (!tracks.length) return interaction.followUp('Playlist is empty.');

    const startedEmpty = !queue.current;
    let added = 0;
    let rejected = 0;
    for (const t of tracks) {
      if (queue.enqueue(t)) added++;
      else rejected++;
    }
    if (added === 0) {
      return interaction.followUp(`Queue is full (max ${MAX_QUEUE}). Nothing added.`);
    }
    const suffix = rejected > 0 ? ` (skipped ${rejected} — queue cap ${MAX_QUEUE})` : '';

    if (startedEmpty) {
      await queue.start();
      await queue.retireNowPlayingMessage();
      await interaction.followUp(`📃 Loaded **${added}** tracks from playlist.${suffix}`);
      const npMsg = await interaction.channel.send({
        embeds: [nowPlayingEmbed(queue.current, { queue, progressSeconds: 0 })],
        components: nowPlayingComponents(queue),
      });
      queue.nowPlayingMessage = npMsg;
      return;
    }
    await queue.refreshNowPlayingMessage();
    return interaction.followUp(`📃 Added **${added}** tracks to queue.${suffix}`);
  }

  let track;
  try {
    track = await resolveTrack(query, interaction.user.tag);
  } catch (err) {
    const card = friendlyErrorEmbed(err);
    if (card) return interaction.followUp({ embeds: [card] });
    return interaction.followUp(`Failed to resolve track: ${err.message}`);
  }

  if (!queue.enqueue(track)) {
    return interaction.followUp(`Queue is full (max ${MAX_QUEUE}).`);
  }

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
