import crypto from 'node:crypto';

const sessions = new Map();
const oauthStates = new Map();
const STATE_TTL = 5 * 60 * 1000;
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

const COOKIE_NAME = 'discord_session';

function adminUserIds() {
  return (process.env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function isAdmin(userId) {
  const ids = adminUserIds();
  return ids.length > 0 && ids.includes(userId);
}

export function parseCookies(req) {
  const header = req.headers.cookie ?? '';
  const out = {};
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = decodeURIComponent(v.join('='));
  }
  return out;
}

export function getSession(req) {
  const sid = parseCookies(req)[COOKIE_NAME];
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (Date.now() > s.expiresAt) {
    sessions.delete(sid);
    return null;
  }
  return { sid, ...s };
}

export function requireAuth(req, res, next) {
  const session = getSession(req);
  if (!session) return res.status(401).json({ error: 'Not authenticated' });
  req.session = session;
  next();
}

function buildAuthorizeUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify',
    state,
    prompt: 'none',
  });
  return `https://discord.com/api/oauth2/authorize?${params}`;
}

async function exchangeCode({ code, clientId, clientSecret, redirectUri }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });
  const res = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function fetchDiscord(path, accessToken) {
  const res = await fetch(`https://discord.com/api/v10${path}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Discord API ${path}: ${res.status}`);
  return res.json();
}

export function registerAuthRoutes(app, config) {
  const { clientId, clientSecret, redirectUri } = config;

  app.get('/auth/login', (_req, res) => {
    if (!clientSecret) return res.status(500).send('CLIENT_SECRET not configured');
    const state = crypto.randomBytes(16).toString('hex');
    oauthStates.set(state, { createdAt: Date.now() });
    res.redirect(buildAuthorizeUrl({ clientId, redirectUri, state }));
  });

  app.get('/auth/callback', async (req, res) => {
    const { code, state } = req.query;
    const stored = oauthStates.get(state);
    if (!stored || Date.now() - stored.createdAt > STATE_TTL) {
      return res.status(400).send('Invalid or expired state');
    }
    oauthStates.delete(state);
    if (!code) return res.status(400).send('Missing code');

    try {
      const tokenData = await exchangeCode({ code, clientId, clientSecret, redirectUri });
      const user = await fetchDiscord('/users/@me', tokenData.access_token);

      if (!isAdmin(user.id)) {
        return res.status(403).send('Forbidden: not an admin');
      }

      const sid = crypto.randomBytes(32).toString('hex');
      sessions.set(sid, {
        userId: user.id,
        username: user.username,
        globalName: user.global_name ?? user.username,
        avatar: user.avatar,
        accessToken: tokenData.access_token,
        expiresAt: Date.now() + SESSION_TTL,
      });

      res.setHeader(
        'Set-Cookie',
        `${COOKIE_NAME}=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL / 1000}`,
      );
      res.redirect('/');
    } catch (err) {
      console.error('[auth callback]', err);
      res.status(500).send(`Auth failed: ${err.message}`);
    }
  });

  app.get('/auth/me', (req, res) => {
    const s = getSession(req);
    if (!s) return res.status(401).json({ error: 'Not authenticated' });
    res.json({
      id: s.userId,
      username: s.username,
      globalName: s.globalName,
      avatar: s.avatar,
    });
  });

  app.post('/auth/logout', (req, res) => {
    const s = getSession(req);
    if (s) sessions.delete(s.sid);
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
    res.json({ ok: true });
  });
}
