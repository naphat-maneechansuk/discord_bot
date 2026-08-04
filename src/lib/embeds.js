import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  ContainerBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  TextDisplayBuilder,
  MessageFlags,
} from 'discord.js';
import { formatDuration } from './track.js';

// longest song title the one-line "up next" hint keeps before trimming
const UP_NEXT_TITLE_MAX = 40;

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

function trimTitle(title, max) {
  const clean = String(title ?? '');
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

// One subtext line closing the card: what plays next (with the queue depth)
// and who asked for the current track. Null when there is nothing to say.
function cardFooter(track, queue) {
  const parts = [];
  const next = queue?.tracks?.[0];
  if (next) {
    const more = queue.tracks.length - 1;
    const tail = more > 0 ? ` ・ +${more} more` : '';
    parts.push(`Up next: ${trimTitle(next.title, UP_NEXT_TITLE_MAX)}${tail}`);
  }
  if (track.requestedBy) parts.push(`Requested by ${track.requestedBy}`);
  if (parts.length === 0) return null;
  return `-# ${parts.join('  ·  ')}`;
}

// The Now Playing card — one accent-colored Components V2 container kept
// deliberately short: title + elapsed time beside a small cover thumbnail,
// the controls, and a single subtext line. Shuffle/loop/queue state is read
// off the button colors instead of spending lines on it, and the full queue
// stays behind the 📋 button / /queue.
// Returns a ready-to-send/edit payload; callers must not add embeds/content
// to it (forbidden once MessageFlags.IsComponentsV2 is set).
export function nowPlayingPayload(track, opts = {}) {
  const { paused = false, queue = null, progressSeconds = 0 } = opts;

  const container = new ContainerBuilder().setAccentColor(
    paused ? COLOR_PAUSED : colorFromSource(track.source),
  );

  const title = track.source ? `**[${track.title}](${track.source})**` : `**${track.title}**`;
  // formatDuration renders 0 as "?:??", which is right for an unknown track
  // length but wrong for a song that simply just started.
  const elapsed = progressSeconds > 0 ? formatDuration(progressSeconds) : '0:00';
  const meta = [track.artist, `\`${elapsed} / ${formatDuration(track.duration)}\``]
    .filter(Boolean)
    .join('  ·  ');
  const header = new TextDisplayBuilder().setContent(
    `${paused ? '⏸️ **Paused**' : '🎵 **Now Playing**'}\n${title}\n${meta}`,
  );

  if (track.thumbnail) {
    container.addSectionComponents(
      new SectionBuilder()
        .addTextDisplayComponents(header)
        .setThumbnailAccessory(
          new ThumbnailBuilder().setURL(track.thumbnail).setDescription('Cover art'),
        ),
    );
  } else {
    container.addTextDisplayComponents(header);
  }

  container.addActionRowComponents(...nowPlayingComponents(queue));

  const footer = cardFooter(track, queue);
  if (footer) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(footer));

  return { components: [container], flags: MessageFlags.IsComponentsV2 };
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

export function playlistLoadedEmbed(count, opts = {}) {
  const { started = false, rejected = 0, maxQueue = null } = opts;
  const e = new EmbedBuilder()
    .setColor(COLOR_SUCCESS)
    .setAuthor({ name: started ? '📃 Playlist — Now Playing' : '📃 Playlist — Added to Queue' })
    .setDescription(
      started
        ? `Loaded **${count}** track${count === 1 ? '' : 's'} — starting playback now.`
        : `Added **${count}** track${count === 1 ? '' : 's'} to the queue.`,
    );
  if (rejected > 0) {
    e.setColor(COLOR_WARN);
    e.addFields({
      name: '⚠️ Skipped',
      value: `**${rejected}** track${rejected === 1 ? '' : 's'} skipped${
        maxQueue ? ` — queue cap is ${maxQueue}` : ''
      }`,
    });
  }
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

// Used when editing the Now Playing card in place after Stop — a V2 message
// can't be downgraded back to a classic embed, so the stopped state is V2 too.
export function stoppedPayload() {
  const container = new ContainerBuilder()
    .setAccentColor(COLOR_STOPPED)
    .addTextDisplayComponents(
      new TextDisplayBuilder().setContent('### ⏹️ Stopped\nQueue cleared. Disconnected from voice.'),
    );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

export function friendListEmbed(friends) {
  const e = new EmbedBuilder().setColor(COLOR_INFO).setAuthor({ name: '👥 Friends' });
  if (!friends.length) {
    return e.setDescription(
      'No one has liked any songs yet.\nPress the **Like** button on a Now Playing card to start your collection.',
    );
  }
  const medals = ['🥇', '🥈', '🥉'];
  const lines = friends.map((f, i) => {
    const rank = medals[i] ?? `\`${String(i + 1).padStart(2, ' ')}.\``;
    return `${rank} **${f.displayName}** — ${f.count} song${f.count === 1 ? '' : 's'}`;
  });
  return e.setDescription(`Pick a friend below to play their liked songs:\n\n${lines.join('\n')}`);
}

export function friendSelectRow(friends) {
  if (!friends.length) return null;
  const select = new StringSelectMenuBuilder()
    .setCustomId('music:friend')
    .setPlaceholder('Choose a friend…')
    .addOptions(
      friends.slice(0, 25).map((f) => ({
        label: f.displayName.slice(0, 100),
        description: `${f.count} liked song${f.count === 1 ? '' : 's'}`,
        value: f.id,
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
        .setAuthor({ name: '🍪 Cookie expired' })
        .setTitle("Can't load this song from YouTube")
        .setDescription(
          'The cookie the bot uses to prove it is not a robot has expired.\n' +
            'Ask the bot owner to refresh `cookies.txt`.',
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
        .setAuthor({ name: '🚫 Video unavailable' })
        .setTitle("This song can't be played")
        .setDescription('The video was deleted or made private. Try another song.'),
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
        .setAuthor({ name: '🌍 Region locked' })
        .setTitle("This song is blocked where the bot is hosted")
        .setDescription('YouTube refuses to serve it from the bot\'s region. Try another song.'),
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
        .setAuthor({ name: '📡 Live not started' })
        .setTitle('This stream or premiere is not on air yet')
        .setDescription('Come back once it starts, or pick another video.'),
  },
  {
    kind: 'rate-limit',
    patterns: [/HTTP Error 429/i, /Too Many Requests/i, /rate[- ]?limit/i],
    build: () =>
      new EmbedBuilder()
        .setColor(COLOR_WARN)
        .setAuthor({ name: '⏳ Rate limited' })
        .setTitle('YouTube is throttling the bot')
        .setDescription('Too many requests in a row. Wait a minute or two and try again.'),
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
        .setAuthor({ name: '🌐 Connection problem' })
        .setTitle('Temporary network trouble')
        .setDescription("Couldn't reach YouTube. Wait a moment and try again."),
  },
  {
    kind: 'unsupported',
    patterns: [/Unsupported URL/i, /is not a valid URL/i, /no suitable extractor/i],
    build: () =>
      new EmbedBuilder()
        .setColor(COLOR_STOPPED)
        .setAuthor({ name: '🔗 Link not supported' })
        .setTitle("The bot can't open this link")
        .setDescription('Only YouTube links or plain search text work. Try a song name instead.'),
  },
  {
    kind: 'no-results',
    patterns: [/No video results/i, /No results found/i],
    build: () =>
      new EmbedBuilder()
        .setColor(COLOR_WARN)
        .setAuthor({ name: '🔎 No results' })
        .setTitle('Nothing matched that search')
        .setDescription('Try different words, or paste a YouTube link directly.'),
  },
  {
    kind: 'spawn',
    patterns: [/ENOENT/i, /spawn .* ENOENT/i, /yt-dlp.*not found/i],
    build: () =>
      new EmbedBuilder()
        .setColor(COLOR_STOPPED)
        .setAuthor({ name: '⚙️ Bot misconfigured' })
        .setTitle('yt-dlp is missing on the server')
        .setDescription("The bot's downloader is gone. Tell the bot owner.")
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
    error: { color: COLOR_STOPPED, icon: '❌' },
  };
  const cfg = map[kind] ?? map.success;
  return new EmbedBuilder().setColor(cfg.color).setAuthor({ name: `${cfg.icon} ${text}` });
}

// Icon-only so the whole control set fits two short rows. A toggle that is on
// turns green — that is what replaced the old "🔀 On   🔁 Track" status line.
function iconButton(customId, emoji, style = ButtonStyle.Secondary) {
  return new ButtonBuilder().setCustomId(customId).setEmoji(emoji).setStyle(style);
}

function loopButton(loopMode) {
  const map = {
    off: { emoji: '🔁', style: ButtonStyle.Secondary },
    track: { emoji: '🔂', style: ButtonStyle.Success },
    queue: { emoji: '🔁', style: ButtonStyle.Success },
  };
  const cfg = map[loopMode] ?? map.off;
  return iconButton('music:loop', cfg.emoji, cfg.style);
}

export function controlsRows({ paused = false, loopMode = 'off', shuffle = false, hasHistory = false } = {}) {
  const row1 = new ActionRowBuilder().addComponents(
    iconButton('music:prev', '⏮️').setDisabled(!hasHistory),
    iconButton(paused ? 'music:resume' : 'music:pause', paused ? '▶️' : '⏸️'),
    iconButton('music:skip', '⏭️'),
    iconButton('music:stop', '⏹️', ButtonStyle.Danger),
    iconButton('music:like', '❤️'),
  );
  const row2 = new ActionRowBuilder().addComponents(
    iconButton('music:shuffle', '🔀', shuffle ? ButtonStyle.Success : ButtonStyle.Secondary),
    loopButton(loopMode),
    iconButton('music:queue', '📋', ButtonStyle.Primary),
  );
  return [row1, row2];
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
