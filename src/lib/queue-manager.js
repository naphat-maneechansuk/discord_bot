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
import { YT_DLP } from './track.js';
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
    let nextTrack;
    let notify = true;

    if (this.loopMode === 'track' && this.current) {
      nextTrack = this.current;
      notify = false;
    } else {
      if (this.loopMode === 'queue' && this.current) {
        this.tracks.push(this.current);
      }
      nextTrack = this.tracks.shift();
    }

    if (!nextTrack) {
      this.current = null;
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
      [next.source, '-f', 'bestaudio[ext=webm]/bestaudio/best', '-o', '-', '--no-playlist', '--quiet', '--no-warnings'],
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

    const resource = createAudioResource(ytProcess.stdout, { inputType: StreamType.Arbitrary });
    this.player.play(resource);

    if (notify && this.textChannel) {
      await this.retireNowPlayingMessage();
      try {
        this.nowPlayingMessage = await this.textChannel.send({
          embeds: [nowPlayingEmbed(next)],
          components: nowPlayingComponents(this),
        });
      } catch {}
    }
  }

  async refreshNowPlayingMessage() {
    if (!this.nowPlayingMessage || !this.current) return;
    try {
      await this.nowPlayingMessage.edit({
        embeds: [nowPlayingEmbed(this.current, { paused: this.status() === 'paused' })],
        components: nowPlayingComponents(this),
      });
    } catch {}
  }

  #cleanup() {
    if (this.currentProcess) {
      try { this.currentProcess.kill(); } catch {}
      this.currentProcess = null;
    }
    if (this.connection && this.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      this.connection.destroy();
    }
    this.connection = null;
    this.nowPlayingMessage = null;
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
