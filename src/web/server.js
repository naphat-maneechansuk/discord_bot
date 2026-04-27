import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { listQueues, peekQueue, getQueue } from '../lib/queue-manager.js';
import { resolveTrack } from '../lib/track.js';

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
  };
}

export function startWebServer(client) {
  const app = express();

  app.use(express.json());
  app.use(express.static(join(__dirname, 'public')));

  app.get('/api/queues', (_req, res) => {
    res.json(listQueues().map((q) => serializeQueue(q, client)));
  });

  app.get('/api/queue/:guildId', (req, res) => {
    const q = peekQueue(req.params.guildId);
    if (!q) return res.json(null);
    res.json(serializeQueue(q, client));
  });

  app.post('/api/queue/:guildId/skip', (req, res) => {
    const q = peekQueue(req.params.guildId);
    if (!q?.current) return res.status(400).json({ error: 'Nothing playing' });
    q.skip();
    res.json({ ok: true });
  });

  app.post('/api/queue/:guildId/pause', (req, res) => {
    const q = peekQueue(req.params.guildId);
    if (!q?.current) return res.status(400).json({ error: 'Nothing playing' });
    res.json({ ok: q.pause() });
  });

  app.post('/api/queue/:guildId/resume', (req, res) => {
    const q = peekQueue(req.params.guildId);
    if (!q?.current) return res.status(400).json({ error: 'Nothing playing' });
    res.json({ ok: q.resume() });
  });

  app.post('/api/queue/:guildId/stop', (req, res) => {
    const q = peekQueue(req.params.guildId);
    if (!q) return res.status(400).json({ error: 'Not connected' });
    q.stop();
    res.json({ ok: true });
  });

  app.post('/api/queue/:guildId/add', async (req, res) => {
    const { query, requestedBy } = req.body ?? {};
    if (!query) return res.status(400).json({ error: 'query required' });
    const existing = peekQueue(req.params.guildId);
    if (!existing?.connection) {
      return res.status(400).json({
        error: 'No active voice session. Use /play in Discord first to join a voice channel.',
      });
    }
    try {
      const track = await resolveTrack(query, requestedBy ?? 'web');
      const queue = getQueue(req.params.guildId);
      queue.enqueue(track);
      if (!queue.current) await queue.start();
      res.json({ ok: true, track: { title: track.title, duration: track.duration } });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.listen(PORT, '127.0.0.1', () => {
    console.log(`Web dashboard: http://localhost:${PORT}`);
  });
}
