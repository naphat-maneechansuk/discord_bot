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
import { YT_DLP, COOKIES_ARGS } from './track.js';
import { nowPlayingEmbed, nowPlayingComponents } from './embeds.js';

const queues = new Map();

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
    this.volume = 1.0;
    this.currentResource = null;
  }

  toggleShuffle() {
    this.shuffle = !this.shuffle;
    return this.shuffle;
  }

  setVolume(v) {
    v = Math.max(0, Math.min(1, v));
    this.volume = v;
    if (this.currentResource?.volume) this.currentResource.volume.setVolume(v);
    return v;
  }

  adjustVolume(delta) {
    return this.setVolume(this.volume + delta);
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
      this.player.stop();
      return true;
    }
    if (this.history.length === 0) return false;
    const prevTrack = this.history.pop();
    if (this.current) this.tracks.unshift(this.current);
    this.tracks.unshift(prevTrack);
    this.current = null;
    this.player.stop();
    return true;
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
    this.tracks.push(track);
  }

  async start() {
    if (!this.current) await this.#playNext({ notify: false });
  }

  setLoopMode(mode) {
    if (!['off', 'track', 'queue'].includes(mode)) return false;
    this.loopMode = mode;
    return true;
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
    const skipped = this.tracks.splice(0, index);
    for (const t of skipped) {
      this.history.push(t);
      if (this.history.length > 50) this.history.shift();
    }
    this._idleOverride = { loop: 'off', shuffle: false };
    this.player.stop();
    return true;
  }

  skip() {
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
    const override = this._idleOverride;
    this._idleOverride = null;
    const loop = override?.loop ?? this.loopMode;
    const shuffle = override?.shuffle ?? this.shuffle;

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

    if (!nextTrack) {
      this.current = null;
      await this.retireNowPlayingMessage();
      this.#cleanup();
      return;
    }
    await this.#playTrack(nextTrack, { notify });
  }

  async #playNext({ notify = true } = {}) {
    const next = this.tracks.shift();
    if (!next) return;
    await this.#playTrack(next, { notify });
  }

  async #playTrack(next, { notify = true } = {}) {
    this.current = next;

    if (this.currentProcess) {
      try { this.currentProcess.kill(); } catch {}
    }

    const ytProcess = spawn(
      YT_DLP,
      [next.source, '-f', 'bestaudio[ext=webm]/bestaudio/best', '-o', '-', '--no-playlist', '--quiet', '--no-warnings', ...COOKIES_ARGS],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    ytProcess.on('error', (err) => console.error('[yt-dlp spawn]', err));
    let stderrBuf = '';
    ytProcess.stderr.on('data', (c) => (stderrBuf += c.toString()));
    ytProcess.on('close', (code) => {
      if (code === 0 || code === null) return;
      if (stderrBuf.includes('Broken pipe')) return;
      if (stderrBuf) console.error(`[yt-dlp ${code}]`, stderrBuf.slice(0, 500));
    });
    this.currentProcess = ytProcess;

    const resource = createAudioResource(ytProcess.stdout, {
      inputType: StreamType.Arbitrary,
      inlineVolume: true,
    });
    if (resource.volume) resource.volume.setVolume(this.volume);
    this.currentResource = resource;
    this.player.play(resource);

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
    if (this.currentProcess) {
      try { this.currentProcess.kill(); } catch {}
      this.currentProcess = null;
    }
    if (this._bumpTimer) {
      clearTimeout(this._bumpTimer);
      this._bumpTimer = null;
    }
    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      this.connection.destroy();
    }
    this.connection = null;
    this.nowPlayingMessage = null;
    this.currentResource = null;
    this.history = [];
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
