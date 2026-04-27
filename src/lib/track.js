import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const YT_DLP = join(__dirname, '..', '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');

export async function resolveTrack(query, requestedBy) {
  const source = query.startsWith('http') ? query : `ytsearch1:${query}`;
  const meta = await dumpJson(source);
  return {
    source: meta.webpage_url || source,
    title: meta.title ?? query,
    artist: meta.artist ?? meta.uploader ?? meta.channel ?? '',
    duration: meta.duration ?? 0,
    thumbnail: meta.thumbnail ?? null,
    requestedBy,
  };
}

function dumpJson(source) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YT_DLP, [source, '--dump-json', '--no-playlist', '--no-warnings', '--quiet'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    proc.stdout.on('data', (c) => (out += c));
    proc.stderr.on('data', (c) => (err += c));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`yt-dlp exited ${code}: ${err.trim()}`));
      try {
        resolve(JSON.parse(out.trim().split('\n')[0]));
      } catch (e) {
        reject(e);
      }
    });
    proc.on('error', reject);
  });
}

export function searchTracks(query, limit = 5) {
  return new Promise((resolve, reject) => {
    const proc = spawn(
      YT_DLP,
      [`ytsearch${limit}:${query}`, '--dump-json', '--no-playlist', '--no-warnings', '--quiet'],
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
            const m = JSON.parse(line);
            return {
              title: m.title ?? '(no title)',
              source: m.webpage_url ?? `https://www.youtube.com/watch?v=${m.id}`,
              duration: m.duration ?? 0,
              thumbnail: m.thumbnail ?? null,
              channel: m.channel ?? m.uploader ?? '',
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

export function formatDuration(seconds) {
  if (!seconds) return '?:??';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
