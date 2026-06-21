import express from 'express';
import { ChannelType } from 'discord.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { listQueues, peekQueue, getQueue, MAX_QUEUE } from '../lib/queue-manager.js';
import { resolveTrack } from '../lib/track.js';
import { registerAuthRoutes, requireAuth } from './auth.js';
import { toggleLike, getUserLikes, listLikers } from '../lib/likes.js';
import { isGuildDisabled, setGuildDisabled } from '../lib/guild-state.js';
import { nowPlayingEmbed, nowPlayingComponents } from '../lib/embeds.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.WEB_PORT ?? 3000;
const HOST = process.env.WEB_HOST ?? '127.0.0.1';

function serializeQueue(q, client, likedSources = null) {
  const guild = client.guilds.cache.get(q.guildId);
  const likedByMe = (src) => (likedSources ? likedSources.has(src) : false);
  return {
    guildId: q.guildId,
    guildName: guild?.name ?? q.guildId,
    current: q.current
      ? {
          title: q.current.title,
          duration: q.current.duration,
          requestedBy: q.current.requestedBy,
          source: q.current.source,
          thumbnail: q.current.thumbnail ?? null,
          artist: q.current.artist ?? '',
          likedByMe: likedByMe(q.current.source),
        }
      : null,
    upcoming: q.tracks.map((t) => ({
      title: t.title,
      duration: t.duration,
      requestedBy: t.requestedBy,
      source: t.source,
      likedByMe: likedByMe(t.source),
    })),
    isPlaying: q.isPlaying(),
    status: q.status(),
    loopMode: q.loopMode,
    lastError: q.lastError ?? null,
  };
}

export function startWebServer(client) {
  const app = express();
  app.use(express.json());
  app.use(express.static(join(__dirname, 'public')));

  registerAuthRoutes(app, {
    clientId: process.env.CLIENT_ID,
    clientSecret: process.env.CLIENT_SECRET,
    redirectUri: process.env.OAUTH_REDIRECT_URI ?? `http://localhost:${PORT}/auth/callback`,
  });

  app.get('/api/queues', requireAuth, async (req, res) => {
    const liked = await getUserLikes(req.session.userId);
    const likedSources = new Set((liked?.tracks ?? []).map((t) => t.source));
    res.json(listQueues().map((q) => serializeQueue(q, client, likedSources)));
  });

  app.get('/api/guilds', requireAuth, (_req, res) => {
    const guilds = client.guilds.cache.map((g) => ({
      id: g.id,
      name: g.name,
      disabled: isGuildDisabled(g.id),
      memberCount: g.memberCount,
      voiceChannels: g.channels.cache
        .filter(
          (c) =>
            c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice,
        )
        .map((c) => ({
          id: c.id,
          name: c.name,
          members: c.members.map((m) => m.displayName ?? m.user?.username ?? 'unknown'),
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }));
    res.json(guilds);
  });

  // Enable / disable the bot in a guild (soft). When disabled the bot ignores
  // new slash commands there; any in-progress queue keeps playing until it ends.
  app.post('/api/guild/:guildId/set-enabled', requireAuth, (req, res) => {
    const { enabled } = req.body ?? {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled (boolean) required' });
    }
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });
    setGuildDisabled(req.params.guildId, !enabled);
    res.json({ ok: true, enabled });
  });

  app.post('/api/guild/:guildId/play', requireAuth, async (req, res) => {
    const { channelId, query } = req.body ?? {};
    if (!channelId || !query) {
      return res.status(400).json({ error: 'channelId and query required' });
    }
    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });
    const channel = guild.channels.cache.get(channelId);
    if (
      !channel ||
      (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)
    ) {
      return res.status(400).json({ error: 'Voice channel not found' });
    }

    const queue = getQueue(req.params.guildId);
    try {
      await queue.ensureConnection(channel);
      const track = await resolveTrack(query, req.session.globalName ?? req.session.username);
      queue.enqueue(track);
      if (!queue.current) await queue.start();
      res.json({ ok: true, track: { title: track.title, duration: track.duration } });
    } catch (err) {
      console.error('[web] play error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/queue/:guildId', requireAuth, (req, res) => {
    const q = peekQueue(req.params.guildId);
    if (!q) return res.json(null);
    res.json(serializeQueue(q, client));
  });

  const guildAction = (handler) => (req, res) => handler(req, res);

  app.post('/api/queue/:guildId/skip', requireAuth, guildAction((req, res) => {
    const q = peekQueue(req.params.guildId);
    if (!q?.current) return res.status(400).json({ error: 'Nothing playing' });
    q.skip();
    res.json({ ok: true });
  }));

  app.post('/api/queue/:guildId/pause', requireAuth, guildAction((req, res) => {
    const q = peekQueue(req.params.guildId);
    if (!q?.current) return res.status(400).json({ error: 'Nothing playing' });
    res.json({ ok: q.pause() });
  }));

  app.post('/api/queue/:guildId/resume', requireAuth, guildAction((req, res) => {
    const q = peekQueue(req.params.guildId);
    if (!q?.current) return res.status(400).json({ error: 'Nothing playing' });
    res.json({ ok: q.resume() });
  }));

  app.post('/api/queue/:guildId/stop', requireAuth, guildAction((req, res) => {
    const q = peekQueue(req.params.guildId);
    if (!q) return res.status(400).json({ error: 'Not connected' });
    q.stop();
    res.json({ ok: true });
  }));

  app.post('/api/queue/:guildId/loop', requireAuth, guildAction(async (req, res) => {
    const q = peekQueue(req.params.guildId);
    if (!q) return res.status(400).json({ error: 'Not connected' });
    if (req.body?.mode) {
      if (!q.setLoopMode(req.body.mode)) return res.status(400).json({ error: 'Invalid mode' });
    } else {
      q.cycleLoopMode();
    }
    await q.refreshNowPlayingMessage();
    res.json({ ok: true, loopMode: q.loopMode });
  }));

  app.delete('/api/queue/:guildId/track/:index', requireAuth, guildAction(async (req, res) => {
    const q = peekQueue(req.params.guildId);
    if (!q) return res.status(400).json({ error: 'Not connected' });
    const idx = parseInt(req.params.index, 10);
    const removed = q.removeAt(idx);
    if (!removed) return res.status(400).json({ error: 'Index out of range' });
    await q.refreshNowPlayingMessage();
    res.json({ ok: true, removed: { title: removed.title } });
  }));

  app.post('/api/queue/:guildId/add', requireAuth, guildAction(async (req, res) => {
    const { query } = req.body ?? {};
    if (!query) return res.status(400).json({ error: 'query required' });
    const existing = peekQueue(req.params.guildId);
    if (!existing?.connection) {
      return res.status(400).json({
        error: 'No active voice session. Use /play in Discord first to join a voice channel.',
      });
    }
    try {
      const track = await resolveTrack(query, req.session.globalName ?? req.session.username);
      existing.enqueue(track);
      if (!existing.current) await existing.start();
      res.json({ ok: true, track: { title: track.title, duration: track.duration } });
    } catch (err) {
      console.error(`[web] add error:`, err.message);
      res.status(500).json({ error: err.message });
    }
  }));

  // ---- Likes & Friends ----

  app.get('/api/likes', requireAuth, async (req, res) => {
    const liked = await getUserLikes(req.session.userId);
    res.json({ tracks: liked?.tracks ?? [] });
  });

  app.post('/api/likes/toggle', requireAuth, async (req, res) => {
    const { source, title } = req.body ?? {};
    if (!source || !title) {
      return res.status(400).json({ error: 'source and title required' });
    }
    const { artist, duration, thumbnail } = req.body;
    try {
      const { liked, count } = await toggleLike(
        req.session.userId,
        req.session.username,
        { source, title, artist, duration, thumbnail },
      );
      res.json({ liked, count });
    } catch (err) {
      console.error('[web] likes/toggle error:', err.message);
      res.status(500).json({ error: 'Failed to update likes' });
    }
  });

  app.get('/api/friends', requireAuth, async (_req, res) => {
    res.json(await listLikers());
  });

  app.post('/api/guild/:guildId/play-friend', requireAuth, async (req, res) => {
    const { friendId, channelId } = req.body ?? {};
    if (!friendId) return res.status(400).json({ error: 'friendId required' });

    const guild = client.guilds.cache.get(req.params.guildId);
    if (!guild) return res.status(404).json({ error: 'Guild not found' });

    const liked = await getUserLikes(friendId);
    if (!liked) return res.status(404).json({ error: 'That friend has no liked songs' });

    const queue = getQueue(req.params.guildId);

    // Need a voice connection: reuse the live one, or join the requested channel.
    if (!queue.connection) {
      if (!channelId) {
        return res.status(400).json({ error: 'Not connected — channelId required to join' });
      }
      const channel = guild.channels.cache.get(channelId);
      if (
        !channel ||
        (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)
      ) {
        return res.status(400).json({ error: 'Voice channel not found' });
      }
      try {
        await queue.ensureConnection(channel);
      } catch (err) {
        return res.status(500).json({ error: `Failed to join voice: ${err.message}` });
      }
    }

    const startedEmpty = !queue.current;
    let added = 0;
    let rejected = 0;
    for (const t of liked.tracks) {
      if (queue.enqueue({ ...t, requestedBy: `❤️ ${liked.username}` })) added++;
      else rejected++;
    }
    if (added === 0) {
      return res.status(400).json({ error: `Queue is full (max ${MAX_QUEUE})` });
    }

    try {
      if (startedEmpty) {
        await queue.start();
        await queue.retireNowPlayingMessage();
        if (queue.textChannel) {
          queue.nowPlayingMessage = await queue.textChannel.send({
            embeds: [nowPlayingEmbed(queue.current, { queue, progressSeconds: 0 })],
            components: nowPlayingComponents(queue),
          });
        }
      } else {
        await queue.refreshNowPlayingMessage();
      }
    } catch (err) {
      console.error('[web] play-friend error:', err.message);
    }
    res.json({ ok: true, added, rejected, started: startedEmpty });
  });

  app.listen(PORT, HOST, () => {
    console.log(`Web dashboard: listening on ${HOST}:${PORT}`);
  });
}
