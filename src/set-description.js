import 'dotenv/config';
import { REST, Routes } from 'discord.js';

const description = `Hi! I'm a personal music bot running on a home server, so occasional hiccups may happen — sorry in advance!

Features
• Play music from YouTube
• Like button on the Now Playing card — tap to save tracks you enjoy
• /friend — see who liked the current track, then play any friend's liked playlist

Enjoy the vibes!`;

if (description.length > 400) {
  console.error(`Description is ${description.length} chars (max 400)`);
  process.exit(1);
}

const rest = new REST().setToken(process.env.DISCORD_TOKEN);
const app = await rest.patch(Routes.currentApplication(), { body: { description } });

console.log(`Updated description (${description.length} chars) for app ${app.name} (${app.id})`);
