import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} from '@discordjs/voice';
import { spawn } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { PassThrough } from 'node:stream';
import { YT_DLP, COOKIES_ARGS, resolvePlaylist, searchTracks } from './track.js';
import * as audioCache from './audio-cache.js';
import { nowPlayingEmbed, nowPlayingComponents } from './embeds.js';

export const MAX_QUEUE = 500;
// how long to stay in the voice channel after a stream failure empties the
// queue, so the user can retry from the dashboard without re-joining
const FAIL_LINGER_MS = 120_000;
// playback shorter than this counts as a failed stream (yt-dlp 403 etc.)
const FAIL_THRESHOLD_MS = 3_000;
// how many fresh tracks autoplay tops the queue up with each time it runs dry
const AUTOPLAY_BATCH = 4;

// Pull the 11-char YouTube id from a watch/share URL, to build a radio mix.
function ytVideoId(url) {
  const m = (url || '').match(/(?:[?&]v=|\/shorts\/|\/embed\/|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

const queues = new Map();

// discord.js client, injected at startup — needed to resolve the voice
// channel object for setStatus() (the voice connection alone can't)
let botClient = null;
export function setBotClient(client) {
  botClient = client;
}

class GuildQueue {
  constructor(guildId) {
    this.guildId = guildId;
    this.tracks = [];
    this.current = null;
    this.connection = null;
    this.textChannel = null;
    this.currentProcess = null;
    this.nowPlayingMessage = null;
    this.loopMode = 'off'; // 'off' | 'track' | 'queue'

    this.player = createAudioPlayer();
    this.player.on(AudioPlayerStatus.Idle, () => this.#onIdle());
    this.player.on('error', (err) => console.error(`[player ${guildId}]`, err.message));

    this.history = [];
    this.shuffle = false;
    this.currentResource = null;
    this.jumpPage = 0;
    this.lastError = null;
    this._stopRequested = false;
    this._lingerTimer = null;
    // Radio mode: when on, a drained queue is refilled with tracks related to
    // the last song instead of the bot leaving. _playedKeys remembers what's
    // been played this session so the radio doesn't loop back on itself.
    this.autoplay = false;
    this._playedKeys = new Set();
  }

  setJumpPage(page) {
    const maxPage = Math.max(0, Math.ceil(this.tracks.length / 25) - 1);
    this.jumpPage = Math.max(0, Math.min(page, maxPage));
    return this.jumpPage;
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    return this.shuffle;
  }

  getProgressSeconds() {
    if (!this.currentResource) return 0;
    return Math.floor((this.currentResource.playbackDuration || 0) / 1000);
  }

  prev() {
    const restart = this.getProgressSeconds() > 5 && this.current;
    if (restart) {
      this.tracks.unshift(this.current);
      this.current = null;
      this._stopRequested = true;
      this.player.stop();
      return true;
    }
    if (this.history.length === 0) return false;
    const prevTrack = this.history.pop();
    if (this.current) this.tracks.unshift(this.current);
    this.tracks.unshift(prevTrack);
    this.current = null;
    this._stopRequested = true;
    this.player.stop();
    return true;
  }

  // "voice channel status" — the short text under the channel name in the
  // channel list. Per-channel per-guild, so it works with the bot playing
  // different songs in multiple servers at once. The endpoint is not in
  // discord.js/discord-api-types yet, so hit the REST route directly.
  #setVoiceStatus(text) {
    const channelId = this.connection?.joinConfig?.channelId;
    if (!botClient || !channelId || this._voiceStatusBlocked) return;
    botClient.rest
      .put(`/channels/${channelId}/voice-status`, {
        body: { status: (text ?? '').slice(0, 500) },
      })
      .catch((err) => {
        // 50013 = Missing Permissions: the bot can't set channel status in this
        // server. It's a cosmetic extra, so stop hammering the REST route for
        // this connection (reset on the next join) and log it just once.
        if (err.code === 50013) {
          this._voiceStatusBlocked = true;
          console.warn(`[voice-status ${this.guildId}] disabled — missing "Set Voice Channel Status" permission`);
          return;
        }
        console.warn(`[voice-status ${this.guildId}]`, err.message);
      });
  }

  async retireNowPlayingMessage() {
    if (!this.nowPlayingMessage) return;
    const msg = this.nowPlayingMessage;
    this.nowPlayingMessage = null;
    try { await msg.delete(); } catch {}
  }

  async ensureConnection(voiceChannel) {
    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      return this.connection;
    }
    this._voiceStatusBlocked = false; // fresh join: retry status once more
    this.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: voiceChannel.guild.id,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });
    await entersState(this.connection, VoiceConnectionStatus.Ready, 15_000);
    this.connection.subscribe(this.player);
    return this.connection;
  }

  enqueue(track) {
    if (this.tracks.length >= MAX_QUEUE) return false;
    this.tracks.push(track);
    return true;
  }

  async start() {
    if (!this.current) await this.#playNext({ notify: false });
  }

  setLoopMode(mode) {
    if (!['off', 'track', 'queue'].includes(mode)) return false;
    this.loopMode = mode;
    return true;
  }

  setAutoplay(on) {
    this.autoplay = !!on;
    return this.autoplay;
  }

  cycleLoopMode() {
    const order = ['off', 'track', 'queue'];
    this.loopMode = order[(order.indexOf(this.loopMode) + 1) % order.length];
    return this.loopMode;
  }

  removeAt(index) {
    if (index < 0 || index >= this.tracks.length) return null;
    const [removed] = this.tracks.splice(index, 1);
    return removed;
  }

  jumpTo(index) {
    if (index < 0 || index >= this.tracks.length) return false;
    const [track] = this.tracks.splice(index, 1);
    this.tracks.unshift(track);
    this._idleOverride = { loop: 'off', shuffle: false };
    this._stopRequested = true;
    this.player.stop();
    return true;
  }

  skip() {
    this._stopRequested = true;
    this.player.stop();
  }

  pause() {
    return this.player.pause();
  }

  resume() {
    return this.player.unpause();
  }

  stop() {
    this.tracks = [];
    this.current = null;
    this._stopRequested = true;
    this.player.stop();
    this.#cleanup();
  }

  isPlaying() {
    return this.player.state.status === AudioPlayerStatus.Playing;
  }

  status() {
    const s = this.player.state.status;
    if (s === AudioPlayerStatus.Playing) return 'playing';
    if (s === AudioPlayerStatus.Paused || s === AudioPlayerStatus.AutoPaused) return 'paused';
    if (s === AudioPlayerStatus.Buffering) return 'buffering';
    return 'idle';
  }

  async #onIdle() {
    const stopRequested = this._stopRequested;
    this._stopRequested = false;
    const playedMs = this.currentResource ? (this.currentResource.playbackDuration || 0) : 0;

    // Stream died almost immediately (e.g. yt-dlp got HTTP 403 from
    // YouTube) — retry the same track once before giving up on it.
    const failed = !stopRequested && !!this.current && playedMs < FAIL_THRESHOLD_MS;
    if (failed && !this.current._retried) {
      const track = this.current;
      track._retried = true;
      console.warn(`[queue ${this.guildId}] stream ended after ${playedMs}ms — retrying: ${track.title}`);
      await this.#playTrack(track, { notify: false });
      return;
    }
    if (failed) {
      this.lastError = `Couldn't stream "${this.current.title}" — YouTube refused twice. Try playing it again.`;
      console.error(`[queue ${this.guildId}] giving up on: ${this.current.title}`);
    } else if (this.current) {
      delete this.current._retried; // played fine; allow future retries under loop
    }

    const override = this._idleOverride;
    this._idleOverride = null;
    let loop = override?.loop ?? this.loopMode;
    const shuffle = override?.shuffle ?? this.shuffle;
    if (failed) loop = 'off'; // never re-queue a track that just failed twice

    let nextTrack;
    let notify = true;

    if (loop === 'track' && this.current) {
      nextTrack = this.current;
      notify = false;
    } else {
      if (this.current) {
        this.history.push(this.current);
        if (this.history.length > 50) this.history.shift();
        if (loop === 'queue') this.tracks.push(this.current);
      }
      if (shuffle && this.tracks.length > 1) {
        const idx = Math.floor(Math.random() * this.tracks.length);
        [this.tracks[0], this.tracks[idx]] = [this.tracks[idx], this.tracks[0]];
      }
      nextTrack = this.tracks.shift();
    }

    // Radio mode: the queue ran dry but autoplay is on — pull tracks related to
    // the song that just finished and keep the music going instead of leaving.
    if (!nextTrack && this.autoplay && !failed && this.current) {
      await this.#fillAutoplay(this.current);
      nextTrack = this.tracks.shift();
      notify = true;
    }

    if (!nextTrack) {
      this.current = null;
      await this.retireNowPlayingMessage();
      if (failed) {
        // stay in the channel for a bit so the user can retry from the
        // dashboard without sending the bot back in
        this.#setVoiceStatus('');
        if (this._lingerTimer) clearTimeout(this._lingerTimer);
        this._lingerTimer = setTimeout(() => this.#cleanup(), FAIL_LINGER_MS);
      } else {
        this.#cleanup();
      }
      return;
    }
    await this.#playTrack(nextTrack, { notify });
  }

  async #playNext({ notify = true } = {}) {
    const next = this.tracks.shift();
    if (!next) return;
    await this.#playTrack(next, { notify });
  }

  // Fetch tracks related to `seed` (YouTube radio mix, falling back to a search)
  // and enqueue a few not already played this session. Returns how many it added.
  async #fillAutoplay(seed) {
    try {
      const id = ytVideoId(seed.source);
      let candidates = [];
      if (id) {
        const mixUrl = `https://www.youtube.com/watch?v=${id}&list=RD${id}`;
        candidates = await resolvePlaylist(mixUrl, 'autoplay', 25);
      }
      if (!candidates.length) {
        const query = seed.artist || seed.title;
        if (query) candidates = await searchTracks(query, 15);
      }
      let added = 0;
      for (const track of candidates) {
        if (added >= AUTOPLAY_BATCH) break;
        const key = audioCache.keyFor(track.source);
        if (!key || this._playedKeys.has(key)) continue; // skip repeats
        if (this.enqueue(track)) {
          this._playedKeys.add(key);
          added++;
        }
      }
      return added;
    } catch (err) {
      console.warn(`[autoplay ${this.guildId}]`, err.message);
      return 0;
    }
  }

  async #playTrack(next, { notify = true } = {}) {
    this.current = next;
    this.lastError = null;
    if (this._lingerTimer) {
      clearTimeout(this._lingerTimer);
      this._lingerTimer = null;
    }

    if (this.currentProcess) {
      try { this.currentProcess.kill(); } catch {}
    }

    const cacheKey = audioCache.keyFor(next.source);
    if (cacheKey) this._playedKeys.add(cacheKey); // so radio won't re-pick it
    const cachedPath = cacheKey ? await audioCache.get(cacheKey) : null;

    let resource;
    if (cachedPath) {
      // Cache hit: stream the stored opus straight off disk — no yt-dlp at all.
      this.currentProcess = null;
      const fileStream = createReadStream(cachedPath);
      fileStream.on('error', (err) => console.error('[audio-cache read]', err.message));
      resource = createAudioResource(fileStream, {
        inputType: StreamType.WebmOpus,
        inlineVolume: false,
      });
    } else {
      const ytProcess = spawn(
        YT_DLP,
        [
          next.source,
          '-f', 'bestaudio[ext=webm][acodec=opus]/bestaudio[acodec=opus]/bestaudio[ext=webm]/bestaudio',
          '-o', '-',
          '--no-playlist',
          '--quiet',
          '--no-warnings',
          ...COOKIES_ARGS,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      );
      ytProcess.on('error', (err) => console.error('[yt-dlp spawn]', err));
      let stderrBuf = '';
      ytProcess.stderr.on('data', (c) => (stderrBuf += c.toString()));

      // Tee the download to the cache while it plays. A clean exit commits the
      // file; a skip/failure (yt-dlp killed → non-zero/null code) discards the
      // partial so we never serve a truncated track later.
      const sink = cacheKey ? audioCache.openWrite(cacheKey) : null;
      if (sink) {
        sink.stream.on('error', () => {}); // disk hiccup must not break playback
        ytProcess.stdout.pipe(sink.stream);
      }
      ytProcess.on('close', (code) => {
        if (sink) {
          if (code === 0) sink.commit();
          else sink.abort();
        }
        if (code === 0 || code === null) return;
        if (stderrBuf.includes('Broken pipe')) return;
        if (stderrBuf) console.error(`[yt-dlp ${code}]`, stderrBuf.slice(0, 500));
      });
      this.currentProcess = ytProcess;

      // Feed playback from a separate branch of the tee so the cache writer and
      // the voice connection each get the full stream independently.
      const audioSide = new PassThrough();
      ytProcess.stdout.pipe(audioSide);
      resource = createAudioResource(audioSide, {
        inputType: StreamType.WebmOpus,
        inlineVolume: false,
      });
    }
    this.currentResource = resource;
    this.player.play(resource);
    this.#setVoiceStatus(`🎵 ${next.title}`);

    if (notify && this.textChannel) {
      await this.retireNowPlayingMessage();
      try {
        this.nowPlayingMessage = await this.textChannel.send({
          embeds: [nowPlayingEmbed(next, { queue: this, progressSeconds: 0 })],
          components: nowPlayingComponents(this),
        });
      } catch {}
    }
  }

  async refreshNowPlayingMessage() {
    if (!this.nowPlayingMessage || !this.current) return;
    try {
      await this.nowPlayingMessage.edit({
        embeds: [
          nowPlayingEmbed(this.current, {
            paused: this.status() === 'paused',
            queue: this,
            progressSeconds: this.getProgressSeconds(),
          }),
        ],
        components: nowPlayingComponents(this),
      });
    } catch {}
  }

  bumpNowPlayingMessage() {
    if (!this.nowPlayingMessage || !this.current || !this.textChannel) return;
    if (this._bumpTimer) return;
    this._bumpTimer = setTimeout(async () => {
      this._bumpTimer = null;
      if (!this.current || !this.textChannel) return;
      const old = this.nowPlayingMessage;
      this.nowPlayingMessage = null;
      if (old) {
        try { await old.delete(); } catch {}
      }
      if (!this.current) return;
      try {
        this.nowPlayingMessage = await this.textChannel.send({
          embeds: [
            nowPlayingEmbed(this.current, {
              paused: this.status() === 'paused',
              queue: this,
              progressSeconds: this.getProgressSeconds(),
            }),
          ],
          components: nowPlayingComponents(this),
        });
      } catch (err) {
        console.error('[bump]', err.message);
      }
    }, 1500);
  }

  #cleanup() {
    this.#setVoiceStatus(''); // must run before the connection is destroyed
    if (this.currentProcess) {
      try { this.currentProcess.kill(); } catch {}
      this.currentProcess = null;
    }
    if (this._bumpTimer) {
      clearTimeout(this._bumpTimer);
      this._bumpTimer = null;
    }
    if (this._lingerTimer) {
      clearTimeout(this._lingerTimer);
      this._lingerTimer = null;
    }
    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      this.connection.destroy();
    }
    this.connection = null;
    this.nowPlayingMessage = null;
    this.currentResource = null;
    this.history = [];
    this.autoplay = false;
    this._playedKeys.clear();
    queues.delete(this.guildId);
  }
}

export function getQueue(guildId) {
  let q = queues.get(guildId);
  if (!q) {
    q = new GuildQueue(guildId);
    queues.set(guildId, q);
  }
  return q;
}

export function peekQueue(guildId) {
  return queues.get(guildId) ?? null;
}

export function listQueues() {
  return Array.from(queues.values());
}
