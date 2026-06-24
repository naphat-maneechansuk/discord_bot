// On-disk cache of the opus audio streams yt-dlp pulls from YouTube.
//
// Without this, every /play — even replaying the exact same song — spawns a
// fresh yt-dlp to re-download the audio. Here we tee the stream to disk on the
// first play (no extra cost: we're already pulling those bytes), so later plays
// of the same track read straight from the file with no yt-dlp at all.
//
// "Cache everything, evict least-recently-used": every track is stored on first
// play; when the cache dir grows past AUDIO_CACHE_MAX_MB the oldest-accessed
// files are deleted until it's back under the cap. Popular songs survive,
// one-offs fall out. The stored bytes are the same webm/opus the bot already
// feeds straight into the voice connection, so replay uses the same decoder.
import { createWriteStream } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { stat, readdir, rename, unlink, utimes } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

export const CACHE_DIR = process.env.AUDIO_CACHE_DIR || join(REPO_ROOT, '.cache', 'audio');
const MAX_BYTES = Math.max(1, Number(process.env.AUDIO_CACHE_MAX_MB) || 4096) * 1024 * 1024;

mkdirSync(CACHE_DIR, { recursive: true });

// Pull the 11-char video id out of any YouTube URL shape so the same video
// keyed from search, a watch URL, or a youtu.be link all hit one cache entry.
const YT_ID = /(?:[?&]v=|\/shorts\/|\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/;

export function keyFor(source) {
  if (!source) return null;
  const m = source.match(YT_ID);
  if (m) return `yt_${m[1]}`;
  // Non-YouTube source: a stable hash still lets repeats of that exact URL hit.
  return `h_${createHash('sha1').update(source).digest('hex').slice(0, 20)}`;
}

function pathFor(key) {
  return join(CACHE_DIR, `${key}.webm`);
}

// Cache hit → the file path (and bump its access time for LRU); miss → null.
export function get(key) {
  if (!key) return null;
  const p = pathFor(key);
  const now = new Date();
  // utimes throws if the file is gone — treat that as a miss.
  return utimes(p, now, now).then(() => p).catch(() => null);
}

// Open a tee target for a first-time play. The caller pipes the yt-dlp stdout
// into `stream`, then calls commit() if the download finished cleanly or
// abort() if it was skipped/failed — so a half-written file never gets served.
export function openWrite(key) {
  const finalPath = pathFor(key);
  const tmpPath = `${finalPath}.${randomBytes(6).toString('hex')}.part`;
  const stream = createWriteStream(tmpPath);
  let settled = false;
  let failed = false;
  stream.on('error', () => { failed = true; }); // disk problem: drop the cache write, keep playing

  return {
    stream,
    async commit() {
      if (settled) return;
      settled = true;
      await new Promise((res) => {
        if (stream.writableFinished) return res();
        stream.once('finish', res);
        stream.once('error', res);
        stream.end();
      });
      if (failed) {
        await unlink(tmpPath).catch(() => {});
        return;
      }
      try {
        await rename(tmpPath, finalPath);
        await enforceLimit();
      } catch {
        await unlink(tmpPath).catch(() => {});
      }
    },
    abort() {
      if (settled) return;
      settled = true;
      failed = true;
      stream.destroy();
      unlink(tmpPath).catch(() => {});
    },
  };
}

// Delete least-recently-accessed entries until the dir is back under the cap.
async function enforceLimit() {
  let files;
  try {
    files = await readdir(CACHE_DIR);
  } catch {
    return;
  }
  const entries = [];
  let total = 0;
  for (const f of files) {
    if (!f.endsWith('.webm')) continue;
    const p = join(CACHE_DIR, f);
    try {
      const st = await stat(p);
      entries.push({ p, size: st.size, atime: st.atimeMs });
      total += st.size;
    } catch {}
  }
  if (total <= MAX_BYTES) return;
  entries.sort((a, b) => a.atime - b.atime); // oldest access first
  for (const e of entries) {
    if (total <= MAX_BYTES) break;
    try {
      await unlink(e.p);
      total -= e.size;
    } catch {}
  }
}
