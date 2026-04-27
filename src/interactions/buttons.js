import { MessageFlags } from 'discord.js';
import { peekQueue } from '../lib/queue-manager.js';
import { nowPlayingEmbed, stoppedEmbed, nowPlayingComponents } from '../lib/embeds.js';

export async function handleMusicButton(interaction) {
  const [, action] = interaction.customId.split(':');
  const q = peekQueue(interaction.guildId);

  const ephemeral = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });

  if (!q?.current) return ephemeral('Nothing playing.');

  switch (action) {
    case 'pause': {
      if (!q.pause()) return ephemeral('Could not pause.');
      return interaction.update({
        embeds: [nowPlayingEmbed(q.current, { paused: true })],
        components: nowPlayingComponents(q),
      });
    }
    case 'resume': {
      if (!q.resume()) return ephemeral('Could not resume.');
      return interaction.update({
        embeds: [nowPlayingEmbed(q.current)],
        components: nowPlayingComponents(q),
      });
    }
    case 'skip': {
      const title = q.current.title;
      q.skip();
      return ephemeral(`⏭ Skipped: ${title}`);
    }
    case 'loop': {
      q.cycleLoopMode();
      return interaction.update({
        embeds: [nowPlayingEmbed(q.current, { paused: q.status() === 'paused' })],
        components: nowPlayingComponents(q),
      });
    }
    case 'stop': {
      q.stop();
      return interaction.update({ embeds: [stoppedEmbed()], components: [] });
    }
    default:
      return ephemeral(`Unknown action: ${action}`);
  }
}
