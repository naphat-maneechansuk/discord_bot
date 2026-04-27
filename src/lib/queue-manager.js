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

const queues = new Map();

class GuildQueue {
  constructor(guildId) {
    this.guildId = guildId;
    this.tracks = [];
    this.current = null;
    this.connection = null;
    this.textChannel = null;
    this.currentProcess = null;

    this.player = createAudioPlayer();
    this.player.on(AudioPlayerStatus.Idle, () => this.#onIdle());
    this.player.on('error', (err) => console.error(`[player ${guildId}]`, err.message));
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
    if (!this.current) await this.#playNext();
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
    return this.player.state.status !== AudioPlayerStatus.Idle;
  }

  async #onIdle() {
    if (this.tracks.length === 0) {
      this.current = null;
      this.#cleanup();
      return;
    }
    await this.#playNext();
  }

  async #playNext() {
    const next = this.tracks.shift();
    if (!next) return;
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
      if (code !== 0 && stderrBuf) console.error(`[yt-dlp ${code}]`, stderrBuf.slice(0, 500));
    });
    this.currentProcess = ytProcess;

    const resource = createAudioResource(ytProcess.stdout, { inputType: StreamType.Arbitrary });
    this.player.play(resource);

    if (this.textChannel) {
      this.textChannel.send(`🎵 Now playing: **${next.title}**`).catch(() => {});
    }
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
