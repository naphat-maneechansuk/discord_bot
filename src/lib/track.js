import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUNDLED_YT_DLP = join(__dirname, '..', '..', 'node_modules', 'youtube-dl-exec', 'bin', process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
export const YT_DLP = process.env.YTDLP_BIN || BUNDLED_YT_DLP;

const COOKIES_PATH = process.env.YTDLP_COOKIES;
export const COOKIES_ARGS = COOKIES_PATH ? ['--cookies', COOKIES_PATH] : [];

const TRACK_FIELDS = ['webpage_url', 'title', 'artist', 'uploader', 'channel', 'duration', 'thumbnail'];
const TRACK_TEMPLATE = TRACK_FIELDS.map((f) => `%(${f})s`).join('\t');

function unNA(v) {
  return v === 'NA' || v === '' ? null : v;
}

export async function resolveTrack(query, requestedBy) {
  const source = query.startsWith('http') ? query : `ytsearch1:${query}`;
  const line = await printOne(source);
  const cols = line.split('\t');
  const get = (k) => unNA(cols[TRACK_FIELDS.indexOf(k)]);
  return {
    source: get('webpage_url') || source,
    title: get('title') ?? query,
    artist: get('artist') ?? get('uploader') ?? get('channel') ?? '',
    duration: Number(get('duration')) || 0,
    thumbnail: get('thumbnail'),
    requestedBy,
  };
}

function printOne(source) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      YT_DLP,
      [source, '--print', TRACK_TEMPLATE, '--no-playlist', '--no-warnings', '--quiet', ...COOKIES_ARGS],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    proc.stdout.on('data', (c) => (out += c));
    proc.stderr.on('data', (c) => (err += c));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`yt-dlp exited ${code}: ${err.trim()}`));
      const first = out.trim().split('\n')[0];
      if (!first) return reject(new Error('yt-dlp returned empty output'));
      resolve(first);
    });
    proc.on('error', reject);
  });
}

export function isPlaylistUrl(url) {
  try {
    const u = new URL(url);
    const list = u.searchParams.get('list');
    if (!list) return false;
    return true;
  } catch {
    return false;
  }
}

const PLAYLIST_FIELDS = ['webpage_url', 'url', 'id', 'title', 'uploader', 'channel', 'duration', 'thumbnail'];
const PLAYLIST_TEMPLATE = PLAYLIST_FIELDS.map((f) => `%(${f})s`).join('\t');

export function resolvePlaylist(url, requestedBy, limit = 100) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      YT_DLP,
      [
        url,
        '--flat-playlist',
        '--print',
        PLAYLIST_TEMPLATE,
        '--playlist-end',
        String(limit),
        '--no-warnings',
        '--quiet',
        ...COOKIES_ARGS,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    proc.stdout.on('data', (c) => (out += c));
    proc.stderr.on('data', (c) => (err += c));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`yt-dlp exited ${code}: ${err.trim()}`));
      try {
        const tracks = out
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const cols = line.split('\t');
            const get = (k) => unNA(cols[PLAYLIST_FIELDS.indexOf(k)]);
            return {
              source: get('webpage_url') || get('url') || `https://www.youtube.com/watch?v=${get('id')}`,
              title: get('title') ?? '(unknown)',
              artist: get('uploader') ?? get('channel') ?? '',
              duration: Number(get('duration')) || 0,
              thumbnail: get('thumbnail'),
              requestedBy,
            };
          });
        resolve(tracks);
      } catch (e) {
        reject(e);
      }
    });
    proc.on('error', reject);
  });
}

const SEARCH_FIELDS = ['webpage_url', 'id', 'title', 'duration', 'thumbnail', 'channel', 'uploader'];
const SEARCH_TEMPLATE = SEARCH_FIELDS.map((f) => `%(${f})s`).join('\t');

export function searchTracks(query, limit = 5) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      YT_DLP,
      [`ytsearch${limit}:${query}`, '--print', SEARCH_TEMPLATE, '--no-playlist', '--no-warnings', '--quiet', ...COOKIES_ARGS],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    proc.stdout.on('data', (c) => (out += c));
    proc.stderr.on('data', (c) => (err += c));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`yt-dlp exited ${code}: ${err.trim()}`));
      try {
        const results = out
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const cols = line.split('\t');
            const get = (k) => unNA(cols[SEARCH_FIELDS.indexOf(k)]);
            return {
              title: get('title') ?? '(no title)',
              source: get('webpage_url') ?? `https://www.youtube.com/watch?v=${get('id')}`,
              duration: Number(get('duration')) || 0,
              thumbnail: get('thumbnail'),
              channel: get('channel') ?? get('uploader') ?? '',
            };
          });
        resolve(results);
      } catch (e) {
        reject(e);
      }
    });
    proc.on('error', reject);
  });
}

// Fast search for slash-command autocomplete: --flat-playlist skips per-video
// extraction so it returns in well under the 3s autocomplete deadline.
const SUGGEST_FIELDS = ['id', 'webpage_url', 'url', 'title', 'duration', 'channel', 'uploader'];
const SUGGEST_TEMPLATE = SUGGEST_FIELDS.map((f) => `%(${f})s`).join('\t');

export function searchSuggestions(query, limit = 10) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      YT_DLP,
      [
        `ytsearch${limit}:${query}`,
        '--flat-playlist',
        '--print',
        SUGGEST_TEMPLATE,
        '--no-warnings',
        '--quiet',
        ...COOKIES_ARGS,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    proc.stdout.on('data', (c) => (out += c));
    proc.stderr.on('data', (c) => (err += c));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`yt-dlp exited ${code}: ${err.trim()}`));
      try {
        const results = out
          .trim()
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const cols = line.split('\t');
            const get = (k) => unNA(cols[SUGGEST_FIELDS.indexOf(k)]);
            const id = get('id');
            let source = get('webpage_url') || get('url') || '';
            if (!/^https?:\/\//i.test(source)) {
              source = id ? `https://www.youtube.com/watch?v=${id}` : source;
            }
            return {
              title: get('title') ?? '(no title)',
              source,
              duration: Number(get('duration')) || 0,
              channel: get('channel') ?? get('uploader') ?? '',
            };
          })
          .filter((t) => /^https?:\/\//i.test(t.source));
        resolve(results);
      } catch (e) {
        reject(e);
      }
    });
    proc.on('error', reject);
  });
}

export function formatDuration(seconds) {
  if (!seconds) return '?:??';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
