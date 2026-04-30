import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAudioResource, AudioPlayerStatus, entersState } from '@discordjs/voice';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FAREWELL_DIR = join(__dirname, '..', '..', 'assets', 'farewell');
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|opus|flac)$/i;

async function pickRandomFarewell() {
  let entries;
  try {
    entries = await readdir(FAREWELL_DIR);
  } catch {
    return null;
  }
  const files = entries.filter((f) => AUDIO_EXT.test(f));
  if (files.length === 0) return null;
  return join(FAREWELL_DIR, files[Math.floor(Math.random() * files.length)]);
}

// Plays one random farewell file through the given player and resolves
// when playback ends (or immediately if no file / on error). Caller is
// responsible for suppressing its own Idle handler while this runs.
export async function playFarewell(player) {
  const file = await pickRandomFarewell();
  if (!file) return false;
  try {
    const resource = createAudioResource(file, { inlineVolume: true });
    if (resource.volume) resource.volume.setVolume(1.0);
    player.play(resource);
    await entersState(player, AudioPlayerStatus.Playing, 5_000);
    await entersState(player, AudioPlayerStatus.Idle, 30_000);
    return true;
  } catch (err) {
    console.error('[farewell]', err.message);
    return false;
  }
}
