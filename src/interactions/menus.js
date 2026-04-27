import { getQueue } from '../lib/queue-manager.js';
import { resolveTrack } from '../lib/track.js';
import { nowPlayingEmbed, queuedEmbed, controlsRow } from '../lib/embeds.js';

export async function handleMusicSelect(interaction) {
  const [, action] = interaction.customId.split(':');

  if (action === 'search') {
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
        components: [controlsRow()],
      });
      queue.nowPlayingMessage = reply;
      return reply;
    }
    return interaction.editReply({
      embeds: [queuedEmbed(track, queue.tracks.length)],
      components: [],
    });
  }
}
