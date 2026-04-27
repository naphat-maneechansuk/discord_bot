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

const data = await rest.put(
  Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
  { body: commands },
);

console.log(`Registered ${data.length} command(s) to guild ${process.env.GUILD_ID}`);
