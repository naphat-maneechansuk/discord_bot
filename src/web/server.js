import express from 'express';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { listQueues, peekQueue } from '../lib/queue-manager.js';

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

  app.use(express.static(join(__dirname, 'public')));

  app.get('/api/queues', (_req, res) => {
    res.json(listQueues().map((q) => serializeQueue(q, client)));
  });

  app.get('/api/queue/:guildId', (req, res) => {
    const q = peekQueue(req.params.guildId);
    if (!q) return res.json(null);
    res.json(serializeQueue(q, client));
  });

  app.listen(PORT, () => {
    console.log(`Web dashboard: http://localhost:${PORT}`);
  });
}
