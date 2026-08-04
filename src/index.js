import 'dotenv/config';
import { Client, Collection, GatewayIntentBits, Events, MessageFlags } from 'discord.js';
import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { startWebServer } from './web/server.js';
import { handleMusicButton } from './interactions/buttons.js';
import { handleMusicSelect } from './interactions/menus.js';
import { peekQueue, listQueues } from './lib/queue-manager.js';
import { flushLikes } from './lib/likes.js';
import { isGuildDisabled, flushGuildState } from './lib/guild-state.js';
import { setStatusClient, clearStaleStatuses, clearVoiceStatus } from './lib/voice-status.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});

client.commands = new Collection();
const commandsDir = join(__dirname, 'commands');
for (const file of await readdir(commandsDir)) {
  if (!file.endsWith('.js')) continue;
  const mod = await import(pathToFileURL(join(commandsDir, file)).href);
  client.commands.set(mod.data.name, mod);
}

client.once(Events.ClientReady, async (c) => {
  console.log(`Bot ready as ${c.user.tag}`);
  setStatusClient(c);
  startWebServer(c);
  // A crash or a deploy restart kills the process before it can wipe the
  // "now playing" line under a voice channel — clean those up here.
  await clearStaleStatuses();
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    // Bot disabled in this guild (from the dashboard): block NEW commands, but
    // leave button/menu controls working so any in-progress queue can finish.
    const guildDisabled = interaction.inGuild() && isGuildDisabled(interaction.guildId);

    if (interaction.isChatInputCommand()) {
      if (guildDisabled) {
        await interaction.reply({
          content: '⛔ The bot is disabled in this server.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
      return;
    }
    if (interaction.isAutocomplete()) {
      if (guildDisabled) {
        await interaction.respond([]).catch(() => {});
        return;
      }
      const command = client.commands.get(interaction.commandName);
      if (command?.autocomplete) await command.autocomplete(interaction);
      return;
    }
    if (interaction.isButton() && interaction.customId.startsWith('music:')) {
      await handleMusicButton(interaction);
      return;
    }
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('music:')) {
      await handleMusicSelect(interaction);
      return;
    }
  } catch (err) {
    console.error(err);
    if (interaction.isAutocomplete()) return; // no reply channel for autocomplete
    const reply = { content: 'Action failed.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) await interaction.followUp(reply).catch(() => {});
    else await interaction.reply(reply).catch(() => {});
  }
});

client.on(Events.MessageCreate, (message) => {
  if (!message.guildId) return;
  const q = peekQueue(message.guildId);
  if (!q?.nowPlayingMessage) return;
  if (message.id === q.nowPlayingMessage.id) return;
  if (message.channelId !== q.nowPlayingMessage.channelId) return;
  q.bumpNowPlayingMessage();
});

// The bot was disconnected or dragged to another channel by someone else.
// Either way the status it left under the old channel has to go — and on a
// disconnect the session is over, so the queue goes with it.
client.on(Events.VoiceStateUpdate, (oldState, newState) => {
  if (oldState.id !== client.user?.id) return;
  if (!oldState.channelId || newState.channelId === oldState.channelId) return; // mute/deafen
  const q = peekQueue(oldState.guild.id);
  // The voice adapter may have already retargeted the connection to the new
  // channel by the time this fires, so accept either side of the move.
  const known = q?.voiceChannelId;
  if (!q || (known !== oldState.channelId && known !== newState.channelId)) return;
  const handled = newState.channelId
    ? q.handleVoiceMove(oldState.channelId, newState.channelId)
    : q.handleExternalDisconnect(oldState.channelId);
  handled.catch((err) => console.error('[voice-state]', err.message));
});

// Persist any pending likes before the service restarts (deploys send SIGTERM),
// and wipe voice channel statuses while the bot is still connected — Discord
// refuses a clear from outside the channel without MANAGE_CHANNELS.
let shuttingDown = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    flushLikes();
    flushGuildState();
    const clears = listQueues()
      .map((q) => q.voiceChannelId)
      .filter(Boolean)
      .map((channelId) => clearVoiceStatus(channelId));
    await Promise.race([
      Promise.allSettled(clears),
      new Promise((r) => setTimeout(r, 4_000)),
    ]);
    client.destroy();
    process.exit(0);
  });
}

client.login(process.env.DISCORD_TOKEN);
