import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from 'discord.js';
import { formatDuration } from './track.js';

const PALETTE = [0x5865f2, 0xeb459e, 0xed4245, 0xfaa61a, 0x57f287, 0x9b59b6, 0x3498db, 0xe67e22];
const COLOR_PAUSED = 0xfaa61a;
const COLOR_STOPPED = 0xed4245;
const COLOR_SUCCESS = 0x23a55a;
const COLOR_INFO = 0x5865f2;
const COLOR_WARN = 0xfaa61a;

function colorFromSource(source) {
  if (!source) return COLOR_INFO;
  let hash = 0;
  for (let i = 0; i < source.length; i++) hash = (hash * 31 + source.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

export function nowPlayingEmbed(track, opts = {}) {
  const { paused = false, queue = null } = opts;
  const e = new EmbedBuilder()
    .setColor(paused ? COLOR_PAUSED : colorFromSource(track.source))
    .setAuthor({ name: paused ? '⏸ Paused' : '🎵 Now Playing' })
    .setTitle(track.title.slice(0, 256))
    .setURL(track.source ?? null);

  if (track.artist) e.setDescription(`by **${track.artist}**`);
  if (track.thumbnail) e.setThumbnail(track.thumbnail);

  const volume = queue ? Math.round(queue.volume * 100) : 100;
  const shuffle = queue?.shuffle ? 'On' : 'Off';
  const loop =
    queue?.loopMode === 'track' ? 'Track' : queue?.loopMode === 'queue' ? 'Queue' : 'Off';
  e.addFields(
    { name: '⏱ Duration', value: formatDuration(track.duration), inline: true },
    { name: '🔊 Volume', value: `${volume}%`, inline: true },
    { name: '🔀 Shuffle', value: shuffle, inline: true },
    { name: '🔁 Loop', value: loop, inline: true },
  );

  if (track.requestedBy) {
    e.setFooter({ text: `Requested by ${track.requestedBy}` });
  }
  return e;
}

export function queuedEmbed(track, position) {
  const e = new EmbedBuilder()
    .setColor(COLOR_SUCCESS)
    .setAuthor({ name: '✅ Added to Queue' })
    .setTitle(track.title.slice(0, 256))
    .setURL(track.source ?? null)
    .addFields(
      { name: 'Position', value: `#${position}`, inline: true },
      { name: 'Duration', value: formatDuration(track.duration), inline: true },
      { name: 'Requested by', value: String(track.requestedBy ?? 'unknown'), inline: true },
    );
  if (track.thumbnail) e.setThumbnail(track.thumbnail);
  return e;
}

export function queueListEmbed(queue) {
  const totalSec =
    (queue.current?.duration || 0) + queue.tracks.reduce((s, t) => s + (t.duration || 0), 0);
  const count = queue.tracks.length + (queue.current ? 1 : 0);

  const lines = [];
  if (queue.current) {
    lines.push('**Now Playing**');
    lines.push(
      `🎵 [${queue.current.title}](${queue.current.source})${queue.current.artist ? ` — ${queue.current.artist}` : ''}`,
    );
    lines.push('');
  }
  if (queue.tracks.length > 0) {
    lines.push('**Up Next**');
    queue.tracks.slice(0, 10).forEach((t, i) => {
      lines.push(
        `\`${i + 1}.\` [${t.title}](${t.source})${t.artist ? ` — ${t.artist}` : ''} \`[${formatDuration(t.duration)}]\``,
      );
    });
    if (queue.tracks.length > 10) {
      lines.push(`*+${queue.tracks.length - 10} more songs*`);
    }
  }

  return new EmbedBuilder()
    .setColor(COLOR_INFO)
    .setTitle(`📋 Queue — ${count} song${count === 1 ? '' : 's'}`)
    .setDescription(lines.join('\n').slice(0, 4000) || 'Empty')
    .setFooter({ text: `Total duration: ${formatDuration(totalSec)}` });
}

export function stoppedEmbed() {
  return new EmbedBuilder()
    .setColor(COLOR_STOPPED)
    .setAuthor({ name: '⏹ Stopped' })
    .setDescription('Queue cleared. Disconnected from voice.');
}

export function searchResultsEmbed(query, results) {
  return new EmbedBuilder()
    .setColor(COLOR_WARN)
    .setTitle('🔍 Search Results')
    .setDescription(
      `Found **${results.length}** results for "${query}" — pick one to add to queue:`,
    );
}

const NUMBER_EMOJI = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'];

export function searchResultsSelect(results) {
  const select = new StringSelectMenuBuilder()
    .setCustomId('music:search')
    .setPlaceholder('Choose a song…')
    .addOptions(
      results.map((r, i) => ({
        label: r.title.slice(0, 100),
        description: `${formatDuration(r.duration)}${r.channel ? ` · ${r.channel}` : ''}`.slice(0, 100),
        value: r.source.slice(0, 100),
        emoji: NUMBER_EMOJI[i] ?? undefined,
      })),
    );
  return new ActionRowBuilder().addComponents(select);
}

const ERROR_RULES = [
  {
    kind: 'cookie',
    patterns: [
      /Sign in to confirm you'?re not a bot/i,
      /Sign in to confirm your age/i,
      /require authentication/i,
      /cookies are no longer valid/i,
      /HTTP Error 401/i,
      /Private video/i,
      /members?-only/i,
      /Use --cookies/i,
      /Requested format is not available/i,
    ],
    build: () =>
      new EmbedBuilder()
        .setColor(COLOR_STOPPED)
        .setAuthor({ name: '🍪 Cookie หมดอายุ' })
        .setTitle('ไม่สามารถโหลดเพลงจาก YouTube ได้')
        .setDescription(
          'Cookie ที่บอทใช้ยืนยันตัวตนกับ YouTube หมดอายุแล้ว\n' +
            'กรุณาแจ้งเจ้าของบอทให้เปลี่ยน `cookies.txt` ใหม่',
        )
        .setFooter({ text: 'YouTube cookie expired — owner action required' }),
  },
  {
    kind: 'unavailable',
    patterns: [
      /Video unavailable/i,
      /This video (?:is|has been) (?:no longer available|removed|unavailable)/i,
      /has been removed/i,
      /removed by the uploader/i,
      /account (?:has been )?terminated/i,
      /violated YouTube/i,
    ],
    build: () =>
      new EmbedBuilder()
        .setColor(COLOR_STOPPED)
        .setAuthor({ name: '🚫 วิดีโอใช้งานไม่ได้' })
        .setTitle('เพลงนี้เล่นไม่ได้')
        .setDescription('วิดีโอถูกลบ หรือเจ้าของตั้งเป็นส่วนตัวแล้ว ลองหาเพลงอื่นแทน'),
  },
  {
    kind: 'geo',
    patterns: [
      /not available in your country/i,
      /geo[- ]restricted/i,
      /blocked it (?:in|on) copyright grounds/i,
      /content isn'?t available in your country/i,
    ],
    build: () =>
      new EmbedBuilder()
        .setColor(COLOR_STOPPED)
        .setAuthor({ name: '🌍 ติดข้อจำกัดภูมิภาค' })
        .setTitle('เพลงนี้ถูกบล็อกในภูมิภาคของเซิร์ฟเวอร์')
        .setDescription('เซิร์ฟเวอร์บอทอยู่ฟินแลนด์ และเพลงนี้บล็อกที่นั่น ลองหาเพลงอื่นแทน'),
  },
  {
    kind: 'live',
    patterns: [
      /This live event will begin/i,
      /Premiere will begin/i,
      /This live stream recording is not available/i,
      /is a live event/i,
    ],
    build: () =>
      new EmbedBuilder()
        .setColor(COLOR_WARN)
        .setAuthor({ name: '📡 ยังไม่เริ่ม Live' })
        .setTitle('ไลฟ์/พรีเมียร์ยังไม่เริ่ม')
        .setDescription('วิดีโอนี้เป็นไลฟ์ที่ยังไม่ออกอากาศ ลองมาใหม่ตอนเริ่ม หรือหาคลิปอื่นแทน'),
  },
  {
    kind: 'rate-limit',
    patterns: [/HTTP Error 429/i, /Too Many Requests/i, /rate[- ]?limit/i],
    build: () =>
      new EmbedBuilder()
        .setColor(COLOR_WARN)
        .setAuthor({ name: '⏳ YouTube จำกัดการเรียก' })
        .setTitle('โดน rate-limit ชั่วคราว')
        .setDescription('YouTube จำกัดการเรียกข้อมูลจากบอทอยู่ รอสัก 1–2 นาทีแล้วลองใหม่'),
  },
  {
    kind: 'network',
    patterns: [
      /HTTP Error 5\d\d/i,
      /timed? out/i,
      /ETIMEDOUT/i,
      /ECONNRESET/i,
      /ENOTFOUND/i,
      /EAI_AGAIN/i,
      /Unable to download (?:webpage|API page)/i,
    ],
    build: () =>
      new EmbedBuilder()
        .setColor(COLOR_WARN)
        .setAuthor({ name: '🌐 เชื่อมต่อไม่ได้' })
        .setTitle('เครือข่ายมีปัญหาชั่วคราว')
        .setDescription('โหลดข้อมูลจาก YouTube ไม่สำเร็จ รอสักครู่แล้วลองใหม่'),
  },
  {
    kind: 'unsupported',
    patterns: [/Unsupported URL/i, /is not a valid URL/i, /no suitable extractor/i],
    build: () =>
      new EmbedBuilder()
        .setColor(COLOR_STOPPED)
        .setAuthor({ name: '🔗 ลิงก์ไม่รองรับ' })
        .setTitle('บอทเปิดลิงก์นี้ไม่ได้')
        .setDescription('รองรับเฉพาะลิงก์ YouTube หรือคำค้นหา ลองส่งลิงก์อื่นหรือพิมพ์ชื่อเพลงแทน'),
  },
  {
    kind: 'no-results',
    patterns: [/No video results/i, /No results found/i],
    build: () =>
      new EmbedBuilder()
        .setColor(COLOR_WARN)
        .setAuthor({ name: '🔎 ไม่พบผลลัพธ์' })
        .setTitle('ค้นหาไม่เจอ')
        .setDescription('ลองเปลี่ยนคำค้นหา หรือวางลิงก์ YouTube ตรงๆ'),
  },
  {
    kind: 'spawn',
    patterns: [/ENOENT/i, /spawn .* ENOENT/i, /yt-dlp.*not found/i],
    build: () =>
      new EmbedBuilder()
        .setColor(COLOR_STOPPED)
        .setAuthor({ name: '⚙️ บอทตั้งค่าผิด' })
        .setTitle('ไม่พบ yt-dlp บนเซิร์ฟเวอร์')
        .setDescription('เครื่องมือภายในของบอทหาย กรุณาแจ้งเจ้าของบอท')
        .setFooter({ text: 'yt-dlp binary missing — owner action required' }),
  },
];

export function classifyError(msg) {
  if (!msg) return null;
  for (const rule of ERROR_RULES) {
    if (rule.patterns.some((re) => re.test(msg))) return rule.kind;
  }
  return null;
}

export function isCookieAuthError(msg) {
  return classifyError(msg) === 'cookie';
}

export function friendlyErrorEmbed(err) {
  const msg = typeof err === 'string' ? err : err?.message;
  const kind = classifyError(msg);
  if (!kind) return null;
  const rule = ERROR_RULES.find((r) => r.kind === kind);
  return rule.build();
}

export function cookieExpiredEmbed() {
  return ERROR_RULES.find((r) => r.kind === 'cookie').build();
}

export function notify(kind, text) {
  const map = {
    success: { color: COLOR_SUCCESS, icon: '✅' },
    skip: { color: COLOR_INFO, icon: '⏭' },
    prev: { color: COLOR_INFO, icon: '⏮' },
    pause: { color: COLOR_WARN, icon: '⏸' },
    resume: { color: COLOR_SUCCESS, icon: '▶️' },
    stop: { color: COLOR_STOPPED, icon: '⏹' },
    shuffle: { color: COLOR_INFO, icon: '🔀' },
    volume: { color: COLOR_INFO, icon: '🔊' },
    error: { color: COLOR_STOPPED, icon: '❌' },
  };
  const cfg = map[kind] ?? map.success;
  return new EmbedBuilder().setColor(cfg.color).setAuthor({ name: `${cfg.icon} ${text}` });
}

function loopButton(loopMode) {
  const map = {
    off: { emoji: '🔁', style: ButtonStyle.Secondary },
    track: { emoji: '🔂', style: ButtonStyle.Success },
    queue: { emoji: '🔁', style: ButtonStyle.Success },
  };
  const cfg = map[loopMode] ?? map.off;
  return new ButtonBuilder()
    .setCustomId('music:loop')
    .setLabel('Loop')
    .setEmoji(cfg.emoji)
    .setStyle(cfg.style);
}

function shuffleButton(on) {
  return new ButtonBuilder()
    .setCustomId('music:shuffle')
    .setLabel('Shuffle')
    .setEmoji('🔀')
    .setStyle(on ? ButtonStyle.Success : ButtonStyle.Secondary);
}

export function controlsRows({ paused = false, loopMode = 'off', shuffle = false, hasHistory = false } = {}) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(paused ? 'music:resume' : 'music:pause')
      .setLabel(paused ? 'Resume' : 'Pause')
      .setEmoji(paused ? '▶️' : '⏸️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music:prev')
      .setLabel('Prev')
      .setEmoji('⏮️')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(!hasHistory),
    new ButtonBuilder()
      .setCustomId('music:skip')
      .setLabel('Skip')
      .setEmoji('⏭️')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('music:stop')
      .setLabel('Stop')
      .setEmoji('⏹️')
      .setStyle(ButtonStyle.Danger),
  );
  const row2 = new ActionRowBuilder().addComponents(
    shuffleButton(shuffle),
    loopButton(loopMode),
    new ButtonBuilder().setCustomId('music:queue').setLabel('Queue').setEmoji('📋').setStyle(ButtonStyle.Primary),
  );
  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('music:vol-').setLabel('-10%').setEmoji('🔉').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('music:vol+').setLabel('+10%').setEmoji('🔊').setStyle(ButtonStyle.Secondary),
  );
  return [row1, row2, row3];
}

function trackOptions(tracks, emoji, offset = 0) {
  return tracks.slice(0, 25).map((t, i) => ({
    label: `${offset + i + 1}. ${t.title}`.slice(0, 100),
    description: `${formatDuration(t.duration)}${t.requestedBy ? ` · ${t.requestedBy}` : ''}`.slice(0, 100),
    value: String(offset + i),
    emoji,
  }));
}

export function queueJumpRow(tracks, page = 0) {
  if (!tracks || tracks.length === 0) return null;
  const totalPages = Math.ceil(tracks.length / 25);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const offset = safePage * 25;
  const slice = tracks.slice(offset, offset + 25);
  const placeholder =
    totalPages > 1
      ? `▶️ Jump to a track (page ${safePage + 1}/${totalPages}, ${tracks.length} total)...`
      : `▶️ Jump to a track (${tracks.length})...`;
  const select = new StringSelectMenuBuilder()
    .setCustomId('music:jump')
    .setPlaceholder(placeholder)
    .addOptions(trackOptions(slice, '▶️', offset));
  return new ActionRowBuilder().addComponents(select);
}

export function jumpPageRow(tracks, page = 0) {
  if (!tracks || tracks.length <= 25) return null;
  const totalPages = Math.ceil(tracks.length / 25);
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('music:jpage-')
      .setLabel('◀ Prev page')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage === 0),
    new ButtonBuilder()
      .setCustomId('music:jpage-info')
      .setLabel(`Page ${safePage + 1}/${totalPages}`)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
    new ButtonBuilder()
      .setCustomId('music:jpage+')
      .setLabel('Next page ▶')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(safePage >= totalPages - 1),
  );
  return row;
}

export function removeSelect(tracks) {
  if (!tracks || tracks.length === 0) return null;
  const select = new StringSelectMenuBuilder()
    .setCustomId('music:remove')
    .setPlaceholder(`🗑️ Choose a track to remove (${tracks.length})...`)
    .addOptions(trackOptions(tracks, '🗑️'));
  return new ActionRowBuilder().addComponents(select);
}

export function nowPlayingComponents(queue) {
  const paused = queue.status() === 'paused';
  const rows = controlsRows({
    paused,
    loopMode: queue.loopMode,
    shuffle: queue.shuffle,
    hasHistory: queue.history.length > 0,
  });
  const jumpRow = queueJumpRow(queue.tracks, queue.jumpPage);
  if (jumpRow) rows.push(jumpRow);
  const pageRow = jumpPageRow(queue.tracks, queue.jumpPage);
  if (pageRow) rows.push(pageRow);
  return rows;
}
