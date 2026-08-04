import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const FILE = join(DATA_DIR, 'voice-status.json');

// Discord rejects a clear from outside the channel unless the bot also has
// MANAGE_CHANNELS, so every clear must be awaited *before* leaving voice.
// PUT /channels/{id}/voice-status is still absent from discord.js, hence raw REST.
const REQUEST_TIMEOUT_MS = 5_000;

let botClient = null;
// channels that answered 50013 — stop hammering REST until the next join
const blocked = new Set();
// channels currently carrying a status we wrote, persisted so a crash or a
// deploy restart (which never reaches the clear) can be healed on next boot
let active = new Set();

try {
  const parsed = JSON.parse(readFileSync(FILE, 'utf8'));
  if (Array.isArray(parsed?.channels)) active = new Set(parsed.channels);
} catch {
  active = new Set();
}

function save() {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify({ channels: [...active] }, null, 2));
  } catch (err) {
    console.error('[voice-status] save failed:', err.message);
  }
}

export function setStatusClient(client) {
  botClient = client;
}

/** Forget a 50013 verdict — call on a fresh join so the bot retries once more. */
export function unblockChannel(channelId) {
  blocked.delete(channelId);
}

async function put(channelId, status) {
  return botClient.rest.put(`/channels/${channelId}/voice-status`, {
    body: { status: status.slice(0, 500) },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
}

/**
 * Write the "now playing" line under the voice channel name. Per-channel, so
 * it stays correct with the bot playing in several servers at once.
 */
export async function setVoiceStatus(channelId, text) {
  if (!botClient || !channelId || blocked.has(channelId)) return false;
  try {
    await put(channelId, text ?? '');
    if (!active.has(channelId)) {
      active.add(channelId);
      save();
    }
    return true;
  } catch (err) {
    reportFailure(channelId, err, 'set');
    return false;
  }
}

/**
 * Wipe the status. MUST be awaited while the bot is still connected to the
 * channel — once it has left, Discord demands MANAGE_CHANNELS on top of
 * SET_VOICE_CHANNEL_STATUS and the clear comes back 50013.
 */
export async function clearVoiceStatus(channelId) {
  if (!botClient || !channelId || blocked.has(channelId)) return false;
  try {
    await put(channelId, '');
    if (active.delete(channelId)) save();
    return true;
  } catch (err) {
    reportFailure(channelId, err, 'clear');
    return false;
  }
}

function reportFailure(channelId, err, action) {
  if (err?.code === 50013) {
    blocked.add(channelId);
    console.warn(
      `[voice-status ${channelId}] ${action} refused — bot needs "Set Voice Channel Status"` +
        ' (plus "Manage Channels" to touch it from outside the channel)',
    );
    return;
  }
  console.warn(`[voice-status ${channelId}] ${action} failed:`, err?.message ?? err);
}

/** Every channel still carrying a status this process wrote. */
export function activeStatusChannels() {
  return [...active];
}

/**
 * Clear statuses left behind by a previous process. The bot is not in those
 * channels any more, so this only succeeds where it has MANAGE_CHANNELS —
 * entries that fail stay on the list and are retried on the next boot.
 */
export async function clearStaleStatuses() {
  const stale = [...active];
  if (stale.length === 0) return;
  console.log(`[voice-status] clearing ${stale.length} status(es) left by a previous run`);
  for (const channelId of stale) {
    blocked.delete(channelId); // a stale entry deserves one fresh attempt
    await clearVoiceStatus(channelId);
  }
}
