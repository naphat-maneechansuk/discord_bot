import 'dotenv/config';
import { Client, Collection, GatewayIntentBits, Events, MessageFlags } from 'discord.js';
import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { startWebServer } from './web/server.js';
import { handleMusicButton } from './interactions/buttons.js';
import { handleMusicSelect } from './interactions/menus.js';
import { peekQueue } from './lib/queue-manager.js';

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

client.once(Events.ClientReady, (c) => {
  console.log(`Bot ready as ${c.user.tag}`);
  startWebServer(c);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
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

client.login(process.env.DISCORD_TOKEN);
