import { MessageFlags } from 'discord.js';
import { peekQueue } from '../lib/queue-manager.js';
import { queueListEmbed } from '../lib/embeds.js';

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
      const ok = q.pause();
      return ephemeral(ok ? '⏸ Paused.' : 'Could not pause.');
    }
    case 'resume': {
      const ok = q.resume();
      return ephemeral(ok ? '▶ Resumed.' : 'Could not resume.');
    }
    case 'skip': {
      const title = q.current.title;
      q.skip();
      return ephemeral(`⏭ Skipped: ${title}`);
    }
    case 'stop': {
      q.stop();
      return ephemeral('⏹ Stopped.');
    }
    default:
      return ephemeral(`Unknown action: ${action}`);
  }
}
