import { MessageFlags } from 'discord.js';
import { peekQueue } from '../lib/queue-manager.js';
import {
  nowPlayingEmbed,
  stoppedEmbed,
  queueListEmbed,
  nowPlayingComponents,
  notify,
} from '../lib/embeds.js';

function rebuiltCard(q) {
  return {
    embeds: [
      nowPlayingEmbed(q.current, {
        paused: q.status() === 'paused',
        queue: q,
        progressSeconds: q.getProgressSeconds(),
      }),
    ],
    components: nowPlayingComponents(q),
  };
}

export async function handleMusicButton(interaction) {
  const [, action] = interaction.customId.split(':');
  const q = peekQueue(interaction.guildId);

  const ephemeralEmbed = (kind, text) =>
    interaction.reply({ embeds: [notify(kind, text)], flags: MessageFlags.Ephemeral });

  if (action === 'jpage-' || action === 'jpage+') {
    if (!q || q.tracks.length <= 25) {
      return interaction.deferUpdate();
    }
    q.setJumpPage(q.jumpPage + (action === 'jpage+' ? 1 : -1));
    return interaction.update(rebuiltCard(q));
  }

  if (action === 'queue') {
    if (!q || (!q.current && q.tracks.length === 0)) {
      return interaction.reply({ content: 'Queue is empty.', flags: MessageFlags.Ephemeral });
    }
    return interaction.reply({ embeds: [queueListEmbed(q)], flags: MessageFlags.Ephemeral });
  }

  if (!q?.current) return ephemeralEmbed('error', 'Nothing playing.');

  switch (action) {
    case 'pause': {
      if (!q.pause()) return ephemeralEmbed('error', 'Could not pause.');
      return interaction.update(rebuiltCard(q));
    }
    case 'resume': {
      if (!q.resume()) return ephemeralEmbed('error', 'Could not resume.');
      return interaction.update(rebuiltCard(q));
    }
    case 'skip': {
      const title = q.current.title;
      q.skip();
      return ephemeralEmbed('skip', `Skipped: ${title}`);
    }
    case 'prev': {
      if (q.history.length === 0 && q.getProgressSeconds() <= 5) {
        return ephemeralEmbed('error', 'No previous track.');
      }
      await interaction.deferUpdate();
      q.prev();
      return;
    }
    case 'loop': {
      q.cycleLoopMode();
      return interaction.update(rebuiltCard(q));
    }
    case 'shuffle': {
      const on = q.toggleShuffle();
      await interaction.update(rebuiltCard(q));
      return interaction.followUp({
        embeds: [notify('shuffle', `Shuffle ${on ? 'on' : 'off'}`)],
        flags: MessageFlags.Ephemeral,
      });
    }
    case 'vol+':
    case 'vol-': {
      const delta = action === 'vol+' ? 0.1 : -0.1;
      const v = q.adjustVolume(delta);
      await interaction.update(rebuiltCard(q));
      return interaction.followUp({
        embeds: [notify('volume', `Volume: ${Math.round(v * 100)}%`)],
        flags: MessageFlags.Ephemeral,
      });
    }
    case 'stop': {
      q.stop();
      return interaction.update({ embeds: [stoppedEmbed()], components: [] });
    }
    default:
      return ephemeralEmbed('error', `Unknown action: ${action}`);
  }
}
