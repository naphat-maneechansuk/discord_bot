import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  StreamType,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  getVoiceConnection,
} from '@discordjs/voice';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const YT_DLP = join(__dirname, '..', '..', 'node_modules', 'youtube-dl-exec', 'bin', 'yt-dlp.exe');

export const data = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Play a song from a YouTube URL or search query')
  .addStringOption((opt) =>
    opt.setName('query').setDescription('YouTube URL or search keywords').setRequired(true),
  );

export async function execute(interaction) {
  const query = interaction.options.getString('query', true);
  const member = interaction.member;
  const voiceChannel = member?.voice?.channel;

  if (!voiceChannel) {
    return interaction.reply({
      content: 'Join a voice channel first.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply();

  const ytArgs = [
    query.startsWith('http') ? query : `ytsearch1:${query}`,
    '-f', 'bestaudio[ext=webm]/bestaudio/best',
    '-o', '-',
    '--no-playlist',
    '--quiet',
    '--no-warnings',
  ];

  const ytProcess = spawn(YT_DLP, ytArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

  let stderrBuf = '';
  ytProcess.stderr.on('data', (chunk) => {
    stderrBuf += chunk.toString();
  });
  ytProcess.on('error', (err) => console.error('[yt-dlp spawn error]', err));

  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId: voiceChannel.guild.id,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 15_000);
  } catch (err) {
    connection.destroy();
    return interaction.followUp(`Failed to connect to voice: ${err.message}`);
  }

  const player = createAudioPlayer();
  const resource = createAudioResource(ytProcess.stdout, { inputType: StreamType.Arbitrary });

  player.play(resource);
  connection.subscribe(player);

  player.on(AudioPlayerStatus.Idle, () => {
    player.stop();
    const conn = getVoiceConnection(voiceChannel.guild.id);
    if (conn) conn.destroy();
  });

  player.on('error', (err) => {
    console.error('[player error]', err.message);
    if (stderrBuf) console.error('[yt-dlp stderr]', stderrBuf);
  });

  return interaction.followUp(`Playing: \`${query}\``);
}
