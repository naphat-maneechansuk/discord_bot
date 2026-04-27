import { MessageFlags } from 'discord.js';
import { getQueue, peekQueue } from '../lib/queue-manager.js';
import { resolveTrack } from '../lib/track.js';
import { nowPlayingEmbed, queuedEmbed, nowPlayingComponents } from '../lib/embeds.js';

export async function handleMusicSelect(interaction) {
  const [, action] = interaction.customId.split(':');

  if (action === 'search') return handleSearchPick(interaction);
  if (action === 'remove') return handleRemove(interaction);
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
      embeds: [nowPlayingEmbed(track)],
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
    return interaction.reply({ content: 'No queue.', flags: MessageFlags.Ephemeral });
  }
  const idx = parseInt(interaction.values[0], 10);
  const removed = q.removeAt(idx);
  if (!removed) {
    return interaction.reply({ content: 'Track no longer in queue.', flags: MessageFlags.Ephemeral });
  }
  await interaction.update({
    embeds: [nowPlayingEmbed(q.current, { paused: q.status() === 'paused' })],
    components: nowPlayingComponents(q),
  });
  await interaction.followUp({
    content: `🗑 Removed: **${removed.title}**`,
    flags: MessageFlags.Ephemeral,
  });
}
