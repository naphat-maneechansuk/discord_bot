import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { listQueues, peekQueue, getQueue } from '../lib/queue-manager.js';
import { resolveTrack } from '../lib/track.js';
import { registerAuthRoutes, requireAuth } from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.WEB_PORT ?? 3000;

function serializeQueue(q, client) {
  const guild = client.guilds.cache.get(q.guildId);
  return {
    guildId: q.guildId,
    guildName: guild?.name ?? q.guildId,
    current: q.current
      ? { title: q.current.title, duration: q.current.duration, requestedBy: q.current.requestedBy, source: q.current.source }
      : null,
    upcoming: q.tracks.map((t) => ({
      title: t.title,
      duration: t.duration,
      requestedBy: t.requestedBy,
      source: t.source,
    })),
    isPlaying: q.isPlaying(),
    status: q.status(),
  };
}

function userCanAccessGuild(session, guildId) {
  return session.guildIds.includes(guildId);
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

  app.get('/api/queues', requireAuth, (req, res) => {
    const accessible = listQueues().filter((q) => userCanAccessGuild(req.session, q.guildId));
    res.json(accessible.map((q) => serializeQueue(q, client)));
  });

  app.get('/api/queue/:guildId', requireAuth, (req, res) => {
    if (!userCanAccessGuild(req.session, req.params.guildId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const q = peekQueue(req.params.guildId);
    if (!q) return res.json(null);
    res.json(serializeQueue(q, client));
  });

  const guildAction = (handler) => (req, res) => {
    if (!userCanAccessGuild(req.session, req.params.guildId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    return handler(req, res);
  };

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

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`Web dashboard: http://localhost:${PORT}`);
  });
}
