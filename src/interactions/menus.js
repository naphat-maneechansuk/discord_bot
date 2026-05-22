import { MessageFlags } from 'discord.js';
import { getQueue, peekQueue, MAX_QUEUE } from '../lib/queue-manager.js';
import { resolveTrack } from '../lib/track.js';
import { getUserLikes } from '../lib/likes.js';
import {
  nowPlayingEmbed,
  queuedEmbed,
  playlistLoadedEmbed,
  nowPlayingComponents,
  notify,
  friendlyErrorEmbed,
} from '../lib/embeds.js';

export async function handleMusicSelect(interaction) {
  const [, action] = interaction.customId.split(':');

  if (action === 'search') return handleSearchPick(interaction);
  if (action === 'remove') return handleRemove(interaction);
  if (action === 'jump') return handleJump(interaction);
  if (action === 'friend') return handleFriendPick(interaction);
}

async function handleSearchPick(interaction) {
  const url = interaction.values[0];
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    return interaction.update({
      content: 'Join a voice channel first.',
      embeds: [],
      components: [],
    });
  }

  await interaction.deferUpdate();

  const queue = getQueue(interaction.guildId);
  queue.textChannel = interaction.channel;

  const [connRes, trackRes] = await Promise.allSettled([
    queue.ensureConnection(voiceChannel),
    resolveTrack(url, interaction.user.tag),
  ]);
  if (connRes.status === 'rejected') {
    return interaction.editReply({
      content: `Failed to join voice: ${connRes.reason.message}`,
      embeds: [],
      components: [],
    });
  }
  if (trackRes.status === 'rejected') {
    const card = friendlyErrorEmbed(trackRes.reason);
    if (card) {
      return interaction.editReply({ content: '', embeds: [card], components: [] });
    }
    return interaction.editReply({ content: `Failed: ${trackRes.reason.message}`, embeds: [], components: [] });
  }
  const track = trackRes.value;

  queue.enqueue(track);

  if (!queue.current) {
    await queue.start();
    await queue.retireNowPlayingMessage();
    await interaction.editReply({
      embeds: [queuedEmbed(track, 1)],
      components: [],
    });
    const npMsg = await interaction.channel.send({
      embeds: [nowPlayingEmbed(track, { queue, progressSeconds: 0 })],
      components: nowPlayingComponents(queue),
    });
    queue.nowPlayingMessage = npMsg;
    return;
  }
  await queue.refreshNowPlayingMessage();
  return interaction.editReply({
    embeds: [queuedEmbed(track, queue.tracks.length)],
    components: [],
  });
}

async function handleRemove(interaction) {
  const q = peekQueue(interaction.guildId);
  if (!q) {
    return interaction.update({ content: 'No queue.', components: [] });
  }
  const idx = parseInt(interaction.values[0], 10);
  const removed = q.removeAt(idx);
  if (!removed) {
    return interaction.update({ content: 'Track no longer in queue.', components: [] });
  }
  await interaction.update({
    content: `🗑 Removed: **${removed.title}**`,
    components: [],
  });
  await q.refreshNowPlayingMessage();
}

async function handleFriendPick(interaction) {
  const friendId = interaction.values[0];
  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    return interaction.update({
      content: 'Join a voice channel first.',
      embeds: [],
      components: [],
    });
  }

  const liked = await getUserLikes(friendId);
  if (!liked) {
    return interaction.update({
      embeds: [notify('error', 'That friend has no liked songs anymore.')],
      components: [],
    });
  }

  await interaction.deferUpdate();

  const queue = getQueue(interaction.guildId);
  queue.textChannel = interaction.channel;

  try {
    await queue.ensureConnection(voiceChannel);
  } catch (err) {
    return interaction.editReply({
      embeds: [notify('error', `Failed to join voice: ${err.message}`)],
      components: [],
    });
  }

  const startedEmpty = !queue.current;
  let added = 0;
  let rejected = 0;
  for (const t of liked.tracks) {
    if (queue.enqueue({ ...t, requestedBy: `❤️ ${liked.username}` })) added++;
    else rejected++;
  }
  if (added === 0) {
    return interaction.editReply({
      embeds: [notify('error', `Queue is full (max ${MAX_QUEUE}). Nothing added.`)],
      components: [],
    });
  }

  if (startedEmpty) {
    await queue.start();
    await queue.retireNowPlayingMessage();
    await interaction.editReply({
      embeds: [playlistLoadedEmbed(added, { started: true, rejected, maxQueue: MAX_QUEUE })],
      components: [],
    });
    const npMsg = await interaction.channel.send({
      embeds: [nowPlayingEmbed(queue.current, { queue, progressSeconds: 0 })],
      components: nowPlayingComponents(queue),
    });
    queue.nowPlayingMessage = npMsg;
    return;
  }
  await queue.refreshNowPlayingMessage();
  return interaction.editReply({
    embeds: [playlistLoadedEmbed(added, { started: false, rejected, maxQueue: MAX_QUEUE })],
    components: [],
  });
}

async function handleJump(interaction) {
  const q = peekQueue(interaction.guildId);
  if (!q?.current) {
    return interaction.reply({
      embeds: [notify('error', 'Nothing playing.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  const idx = parseInt(interaction.values[0], 10);
  const target = q.tracks[idx];
  if (!target) {
    return interaction.reply({
      embeds: [notify('error', 'Track no longer in queue.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  if (!q.jumpTo(idx)) {
    return interaction.reply({
      embeds: [notify('error', 'Jump failed.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  await interaction.deferUpdate();
  await interaction.followUp({
    embeds: [notify('skip', `Jumped to: ${target.title}`)],
    flags: MessageFlags.Ephemeral,
  });
}

