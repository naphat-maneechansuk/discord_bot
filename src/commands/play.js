import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import { getQueue, MAX_QUEUE } from '../lib/queue-manager.js';
import {
  resolveTrack,
  resolvePlaylist,
  isPlaylistUrl,
  searchSuggestions,
  formatDuration,
} from '../lib/track.js';
import {
  queuedEmbed,
  playlistLoadedEmbed,
  friendlyErrorEmbed,
} from '../lib/embeds.js';

export const data = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Play a song or add to queue')
  .addStringOption((opt) =>
    opt
      .setName('query')
      .setDescription('YouTube URL, or type 3+ letters to see song suggestions')
      .setRequired(true)
      .setAutocomplete(true),
  );

// --- Autocomplete: live YouTube search shown while typing ---
const MIN_CHARS = 3;
const DEBOUNCE_MS = 150;
const CACHE_TTL = 5 * 60 * 1000;
// Discord discards an autocomplete answer after 3s (counted from before the
// interaction even reaches us) and the client then shows its loading skeleton
// forever. Budget from the moment we pick it up — debounce included — and
// answer with something pressable rather than blow the deadline.
const ANSWER_BUDGET_MS = 2_000;
const suggestCache = new Map(); // query -> { at, choices }
const latestQuery = new Map(); // userId -> last focused value (for debounce)

function choiceLabel({ title, channel, duration }) {
  const dur = duration ? ` (${formatDuration(duration)})` : '';
  const tail = channel ? ` — ${channel}` : '';
  let label = `${title}${tail}${dur}`;
  if (label.length > 100) label = label.slice(0, 99) + '…';
  return label;
}

// Submitting plain text plays its top YouTube hit, so the query itself is a
// valid choice — that is what the user gets when the search is too slow.
function topResultChoice(query) {
  return [{ name: `🔎 Play the top result for “${query}”`.slice(0, 100), value: query.slice(0, 100) }];
}

// The best cached answer for a query still being typed: an exact hit, else the
// results of the longest prefix already searched (fresh enough to still fit).
function cachedChoices(query) {
  let best = null;
  for (const [key, entry] of suggestCache) {
    if (Date.now() - entry.at > CACHE_TTL) {
      suggestCache.delete(key);
      continue;
    }
    if (!query.startsWith(key)) continue;
    if (!best || key.length > best.key.length) best = { key, entry };
  }
  return best?.entry.choices ?? null;
}

async function safeRespond(interaction, choices) {
  if (interaction.responded) return;
  // Past the 3s deadline Discord rejects with "Unknown interaction" — ignore it.
  await interaction.respond(choices).catch(() => {});
}

export async function autocomplete(interaction) {
  const startedAt = Date.now();
  const focused = interaction.options.getFocused().trim();
  const userId = interaction.user.id;

  // Nothing useful to search: too short, or already a URL they can just submit.
  if (focused.length < MIN_CHARS || /^https?:\/\//i.test(focused)) {
    return safeRespond(interaction, []);
  }

  const exact = suggestCache.get(focused);
  if (exact && Date.now() - exact.at < CACHE_TTL) {
    return safeRespond(interaction, exact.choices);
  }

  // Debounce: every keystroke is its own interaction, so we let only the
  // value that stays put for DEBOUNCE_MS actually spawn yt-dlp. Intermediate
  // keystrokes reuse what a shorter prefix already found.
  latestQuery.set(userId, focused);
  await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
  if (latestQuery.get(userId) !== focused) {
    return safeRespond(interaction, cachedChoices(focused) ?? []);
  }

  // The search keeps running past the deadline: its result still lands in the
  // cache, so the next keystroke answers instantly instead of stalling again.
  const search = searchSuggestions(focused, 10)
    .then((tracks) => {
      const choices = tracks.map((t) => ({ name: choiceLabel(t), value: t.source.slice(0, 100) }));
      suggestCache.set(focused, { at: Date.now(), choices });
      return choices;
    })
    .catch(() => null);

  const left = Math.max(0, ANSWER_BUDGET_MS - (Date.now() - startedAt));
  const timeout = new Promise((r) => setTimeout(() => r(undefined), left));
  const winner = await Promise.race([search, timeout]);
  if (winner === undefined) {
    console.warn(`[autocomplete] search for "${focused}" missed the ${ANSWER_BUDGET_MS}ms budget`);
  }
  return safeRespond(
    interaction,
    winner ?? cachedChoices(focused) ?? topResultChoice(focused),
  );
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

  // A plain query goes straight to its top YouTube hit — the autocomplete list
  // is where the user picks a specific song, so submitting text as-is means
  // "just play it" rather than another menu. resolveTrack does the ytsearch1.
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
      await interaction.followUp({
        embeds: [playlistLoadedEmbed(added, { started: true, rejected, maxQueue: MAX_QUEUE })],
      });
      await queue.postNowPlayingCard(interaction.channel);
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
    await interaction.followUp({ embeds: [queuedEmbed(track, 1)] });
    await queue.postNowPlayingCard(interaction.channel);
    return;
  }
  await queue.refreshNowPlayingMessage();
  return interaction.followUp({ embeds: [queuedEmbed(track, queue.tracks.length)] });
}
