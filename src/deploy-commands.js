import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { readdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const commandsDir = join(__dirname, 'commands');

const commands = [];
for (const file of await readdir(commandsDir)) {
  if (!file.endsWith('.js')) continue;
  const mod = await import(pathToFileURL(join(commandsDir, file)).href);
  commands.push(mod.data.toJSON());
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

const guildId = process.env.GUILD_ID;
const route = guildId
  ? Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId)
  : Routes.applicationCommands(process.env.CLIENT_ID);

const data = await rest.put(route, { body: commands });

console.log(
  `Registered ${data.length} command(s) ${guildId ? `to guild ${guildId}` : 'globally (may take up to 1 hour to propagate)'}`,
);
