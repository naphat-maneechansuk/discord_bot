import { MessageFlags } from 'discord.js';
import { peekQueue } from '../lib/queue-manager.js';
import { nowPlayingEmbed, queueListEmbed, stoppedEmbed, controlsRow } from '../lib/embeds.js';

export async function handleMusicButton(interaction) {
  const [, action] = interaction.customId.split(':');
  const q = peekQueue(interaction.guildId);

  const ephemeral = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

  if (action === 'queue') {
    if (!q || (!q.current && q.tracks.length === 0)) return ephemeral('Queue is empty.');
    return interaction.reply({ embeds: [queueListEmbed(q)], flags: MessageFlags.Ephemeral });
  }

  if (!q?.current) return ephemeral('Nothing playing.');

  switch (action) {
    case 'pause': {
      if (!q.pause()) return ephemeral('Could not pause.');
      return interaction.update({
        embeds: [nowPlayingEmbed(q.current, { paused: true })],
        components: [controlsRow({ paused: true })],
      });
    }
    case 'resume': {
      if (!q.resume()) return ephemeral('Could not resume.');
      return interaction.update({
        embeds: [nowPlayingEmbed(q.current)],
        components: [controlsRow()],
      });
    }
    case 'skip': {
      const title = q.current.title;
      q.skip();
      return ephemeral(`⏭ Skipped: ${title}`);
    }
    case 'stop': {
      q.stop();
      return interaction.update({ embeds: [stoppedEmbed()], components: [] });
    }
    default:
      return ephemeral(`Unknown action: ${action}`);
  }
}
