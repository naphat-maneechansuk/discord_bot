import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { formatDuration } from './track.js';

const COLOR_PLAYING = 0x43b581;
const COLOR_PAUSED = 0xfaa61a;
const COLOR_QUEUED = 0x5865f2;
const COLOR_STOPPED = 0xed4245;

export function nowPlayingEmbed(track, { paused = false } = {}) {
  const e = new EmbedBuilder()
    .setColor(paused ? COLOR_PAUSED : COLOR_PLAYING)
    .setAuthor({ name: paused ? '⏸ Paused' : '🎵 Now Playing' })
    .setTitle(track.title)
    .setURL(track.source ?? null)
    .addFields(
      { name: 'Duration', value: formatDuration(track.duration), inline: true },
      { name: 'Requested by', value: String(track.requestedBy ?? 'unknown'), inline: true },
    );
  if (track.thumbnail) e.setThumbnail(track.thumbnail);
  return e;
}

export function queuedEmbed(track, position) {
  const e = new EmbedBuilder()
    .setColor(COLOR_QUEUED)
    .setAuthor({ name: `➕ Added to Queue · #${position}` })
    .setTitle(track.title)
    .setURL(track.source ?? null)
    .addFields(
      { name: 'Duration', value: formatDuration(track.duration), inline: true },
      { name: 'Requested by', value: String(track.requestedBy ?? 'unknown'), inline: true },
    );
  if (track.thumbnail) e.setThumbnail(track.thumbnail);
  return e;
}

export function queueListEmbed(queue) {
  const e = new EmbedBuilder().setColor(COLOR_QUEUED).setTitle('📋 Queue');
  const parts = [];
  if (queue.current) {
    parts.push(`▶ **Now:** [${queue.current.title}](${queue.current.source}) \`[${formatDuration(queue.current.duration)}]\``);
  }
  if (queue.tracks.length > 0) {
    parts.push('');
    parts.push('**Up next:**');
    queue.tracks.slice(0, 10).forEach((t, i) => {
      parts.push(`${i + 1}. [${t.title}](${t.source}) \`[${formatDuration(t.duration)}]\``);
    });
    if (queue.tracks.length > 10) parts.push(`...and ${queue.tracks.length - 10} more`);
  }
  e.setDescription(parts.join('\n').slice(0, 4000) || 'Empty');
  return e;
}

export function stoppedEmbed() {
  return new EmbedBuilder()
    .setColor(COLOR_STOPPED)
    .setAuthor({ name: '⏹ Stopped' })
    .setDescription('Queue cleared. Disconnected from voice.');
}

export function controlsRow({ paused = false } = {}) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(paused ? 'music:resume' : 'music:pause')
      .setLabel(paused ? 'Resume' : 'Pause')
      .setEmoji(paused ? '▶️' : '⏸️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('music:skip').setLabel('Skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('music:queue').setLabel('Queue').setEmoji('📋').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('music:stop').setLabel('Stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
  );
}
