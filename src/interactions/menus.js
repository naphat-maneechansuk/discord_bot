import { MessageFlags } from 'discord.js';
import { getQueue, peekQueue } from '../lib/queue-manager.js';
import { resolveTrack } from '../lib/track.js';
import {
  nowPlayingEmbed,
  queuedEmbed,
  nowPlayingComponents,
  notify,
} from '../lib/embeds.js';

export async function handleMusicSelect(interaction) {
  const [, action] = interaction.customId.split(':');

  if (action === 'search') return handleSearchPick(interaction);
  if (action === 'remove') return handleRemove(interaction);
  if (action === 'jump') return handleJump(interaction);
  if (action === 'move') return handleMove(interaction);
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

  let track;
  try {
    track = await resolveTrack(url, interaction.user.tag);
  } catch (err) {
    return interaction.editReply({ content: `Failed: ${err.message}`, embeds: [], components: [] });
  }

  const queue = getQueue(interaction.guildId);
  queue.textChannel = interaction.channel;

  try {
    await queue.ensureConnection(voiceChannel);
  } catch (err) {
    return interaction.editReply({
      content: `Failed to join voice: ${err.message}`,
      embeds: [],
      components: [],
    });
  }

  queue.enqueue(track);

  if (!queue.current) {
    await queue.start();
    await queue.retireNowPlayingMessage();
    const reply = await interaction.editReply({
      embeds: [nowPlayingEmbed(track, { queue, progressSeconds: 0 })],
      components: nowPlayingComponents(queue),
    });
    queue.nowPlayingMessage = reply;
    return reply;
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

async function handleMove(interaction) {
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
  if (!q.moveToNext(idx)) {
    return interaction.reply({
      embeds: [notify('error', 'Move failed.')],
      flags: MessageFlags.Ephemeral,
    });
  }
  await interaction.update({
    embeds: [
      nowPlayingEmbed(q.current, {
        paused: q.status() === 'paused',
        queue: q,
        progressSeconds: q.getProgressSeconds(),
      }),
    ],
    components: nowPlayingComponents(q),
  });
  await interaction.followUp({
    embeds: [notify('success', `Moved to next: ${target.title}`)],
    flags: MessageFlags.Ephemeral,
  });
}
