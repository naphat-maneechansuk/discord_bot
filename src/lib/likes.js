import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const FILE = join(DATA_DIR, 'likes.json');

// state.users: { [userId]: { username, tracks: [{ source, title, artist, duration, thumbnail, likedAt }] } }
let state = { users: {} };
let loaded = false;
let writeTimer = null;

async function ensureLoaded() {
  if (loaded) return;
  try {
    const parsed = JSON.parse(await readFile(FILE, 'utf8'));
    state =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? parsed
        : { users: {} };
    if (!state.users || typeof state.users !== 'object') state.users = {};
  } catch {
    state = { users: {} };
  }
  loaded = true;
}

function scheduleSave() {
  if (writeTimer) return;
  writeTimer = setTimeout(async () => {
    writeTimer = null;
    try {
      await mkdir(DATA_DIR, { recursive: true });
      await writeFile(FILE, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error('[likes] save failed:', err.message);
    }
  }, 1000);
}

/** Toggle a track in a user's liked list. Returns { liked, count }. */
export async function toggleLike(userId, username, track) {
  if (!track?.source || !track?.title) {
    throw new Error('track must have source and title');
  }
  await ensureLoaded();
  const user = state.users[userId] ?? (state.users[userId] = { username, tracks: [] });
  user.username = username;
  const idx = user.tracks.findIndex((t) => t.source === track.source);
  let liked;
  if (idx >= 0) {
    user.tracks.splice(idx, 1);
    liked = false;
  } else {
    user.tracks.push({
      source: track.source,
      title: track.title,
      artist: track.artist ?? '',
      duration: track.duration ?? 0,
      thumbnail: track.thumbnail ?? null,
      likedAt: Date.now(),
    });
    liked = true;
  }
  scheduleSave();
  return { liked, count: user.tracks.length };
}

/** Returns { username, tracks } for a user, or null if they have no likes. */
export async function getUserLikes(userId) {
  await ensureLoaded();
  const user = state.users[userId];
  if (!user || !Array.isArray(user.tracks) || user.tracks.length === 0) return null;
  return { username: user.username, tracks: user.tracks };
}

/** All users with at least one like, sorted by count desc. */
export async function listLikers() {
  await ensureLoaded();
  return Object.entries(state.users)
    .filter(([, u]) => Array.isArray(u?.tracks) && u.tracks.length > 0)
    .map(([id, u]) => ({ id, username: u.username, count: u.tracks.length }))
    .sort((a, b) => b.count - a.count);
}

/** Synchronously flush a pending debounced write — call on process shutdown. */
export function flushLikes() {
  if (!writeTimer) return;
  clearTimeout(writeTimer);
  writeTimer = null;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[likes] flush failed:', err.message);
  }
}
