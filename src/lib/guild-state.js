import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', '..', 'data');
const FILE = join(DATA_DIR, 'guild-state.json');

// state.disabled: { [guildId]: true } — guilds where the bot ignores new commands.
let state = { disabled: {} };
let writeTimer = null;

// Loaded synchronously at import so isGuildDisabled() can be used in the
// interaction hot path without an await on every command.
try {
  const parsed = JSON.parse(readFileSync(FILE, 'utf8'));
  if (parsed && typeof parsed === 'object' && parsed.disabled && typeof parsed.disabled === 'object') {
    state = { disabled: parsed.disabled };
  }
} catch {
  state = { disabled: {} };
}

function scheduleSave() {
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    try {
      mkdirSync(DATA_DIR, { recursive: true });
      writeFileSync(FILE, JSON.stringify(state, null, 2));
    } catch (err) {
      console.error('[guild-state] save failed:', err.message);
    }
  }, 1000);
}

/** True if the bot has been disabled in this guild from the dashboard. */
export function isGuildDisabled(guildId) {
  return !!state.disabled[guildId];
}

/** Enable or disable the bot in a guild. Returns the new enabled state. */
export function setGuildDisabled(guildId, disabled) {
  if (disabled) state.disabled[guildId] = true;
  else delete state.disabled[guildId];
  scheduleSave();
  return !isGuildDisabled(guildId);
}

/** List of guild IDs currently disabled. */
export function listDisabledGuilds() {
  return Object.keys(state.disabled);
}

/** Synchronously flush a pending debounced write — call on process shutdown. */
export function flushGuildState() {
  if (!writeTimer) return;
  clearTimeout(writeTimer);
  writeTimer = null;
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(FILE, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error('[guild-state] flush failed:', err.message);
  }
}
