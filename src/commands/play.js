import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getQueue, MAX_QUEUE } from '../lib/queue-manager.js';
import {
  resolveTrack,
  resolvePlaylist,
  isPlaylistUrl,
  searchTracks,
  searchSuggestions,
  formatDuration,
} from '../lib/track.js';
import {
  nowPlayingEmbed,
  queuedEmbed,
  playlistLoadedEmbed,
  nowPlayingComponents,
  searchResultsEmbed,
  searchResultsSelect,
  friendlyErrorEmbed,
} from '../lib/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Play a song or add to queue')
  .addStringOption((opt) =>
    opt
      .setName('query')
      .setDescription('YouTube URL or search keywords')
      .setRequired(true)
      .setAutocomplete(true),
  );

// --- Autocomplete: live YouTube search shown while typing ---
const MIN_CHARS = 1;
const DEBOUNCE_MS = 300;
const CACHE_TTL = 5 * 60 * 1000;
const suggestCache = new Map(); // query -> { at, choices }
const latestQuery = new Map(); // userId -> last focused value (for debounce)

function choiceLabel({ title, channel, duration }) {
  const dur = duration ? ` (${formatDuration(duration)})` : '';
  const tail = channel ? ` — ${channel}` : '';
  let label = `${title}${tail}${dur}`;
  if (label.length > 100) label = label.slice(0, 99) + '…';
  return label;
}

async function safeRespond(interaction, choices) {
  if (interaction.responded) return;
  // Past the 3s deadline Discord rejects with "Unknown interaction" — ignore it.
  await interaction.respond(choices).catch(() => {});
}

export async function autocomplete(interaction) {
  const focused = interaction.options.getFocused().trim();
  const userId = interaction.user.id;

  // Nothing useful to search: too short, or already a URL they can just submit.
  if (focused.length < MIN_CHARS || /^https?:\/\//i.test(focused)) {
    return safeRespond(interaction, []);
  }

  const cached = suggestCache.get(focused);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return safeRespond(interaction, cached.choices);
  }

  // Debounce: every keystroke is its own interaction, so we let only the
  // value that stays put for DEBOUNCE_MS actually spawn yt-dlp. Intermediate
  // keystrokes respond empty cheaply instead of piling up searches.
  latestQuery.set(userId, focused);
  await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
  if (latestQuery.get(userId) !== focused) {
    return safeRespond(interaction, []);
  }

  let choices = [];
  try {
    const tracks = await searchSuggestions(focused, 10);
    choices = tracks.map((t) => ({ name: choiceLabel(t), value: t.source.slice(0, 100) }));
    suggestCache.set(focused, { at: Date.now(), choices });
  } catch {
    choices = [];
  }
  return safeRespond(interaction, choices);
}

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

  if (isPlaylistUrl(query)) {
    const [connRes, listRes] = await Promise.allSettled([
      queue.ensureConnection(voiceChannel),
      resolvePlaylist(query, interaction.user.tag),
    ]);
    if (connRes.status === 'rejected') {
      return interaction.followUp(`Failed to join voice: ${connRes.reason.message}`);
    }
    if (listRes.status === 'rejected') {
      const card = friendlyErrorEmbed(listRes.reason);
      if (card) return interaction.followUp({ embeds: [card] });
      return interaction.followUp(`Failed to load playlist: ${listRes.reason.message}`);
    }
    const tracks = listRes.value;
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
    if (startedEmpty) {
      await queue.start();
      await queue.retireNowPlayingMessage();
      await interaction.followUp({
        embeds: [playlistLoadedEmbed(added, { started: true, rejected, maxQueue: MAX_QUEUE })],
      });
      const npMsg = await interaction.channel.send({
        embeds: [nowPlayingEmbed(queue.current, { queue, progressSeconds: 0 })],
        components: nowPlayingComponents(queue),
      });
      queue.nowPlayingMessage = npMsg;
      return;
    }
    await queue.refreshNowPlayingMessage();
    return interaction.followUp({
      embeds: [playlistLoadedEmbed(added, { started: false, rejected, maxQueue: MAX_QUEUE })],
    });
  }

  const [connRes, trackRes] = await Promise.allSettled([
    queue.ensureConnection(voiceChannel),
    resolveTrack(query, interaction.user.tag),
  ]);
  if (connRes.status === 'rejected') {
    return interaction.followUp(`Failed to join voice: ${connRes.reason.message}`);
  }
  if (trackRes.status === 'rejected') {
    const card = friendlyErrorEmbed(trackRes.reason);
    if (card) return interaction.followUp({ embeds: [card] });
    return interaction.followUp(`Failed to resolve track: ${trackRes.reason.message}`);
  }
  const track = trackRes.value;

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
