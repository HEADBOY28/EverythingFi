// Visitor accounts with Google sign-in.
//   GET    -> { clientId, user }   the Google client ID (public) and who is signed in
//   POST   -> sign in with a Google ID token: { credential, consent }
//   PATCH  -> answer the one-time "get updates by email?" question: { consent: true|false }
//   DELETE -> sign out
const crypto = require('crypto');
const { redis, makeUserCookie, clearUserCookie, readUser } = require('./_lib');

const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
const PER_HOUR = 20; // sign-in attempts per visitor IP per hour

function publicUser(u, record) {
  if (!u) return null;
  // Ask about email updates once, until the visitor answers.
  const askConsent = !!record && !record.consent && !record.optinAsked;
  return { name: u.name, email: u.email, picture: u.picture, askConsent };
}

async function getRecord(email) {
  const [raw] = await redis([['HGET', 'users', email]]);
  try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}

// Ask Google to check the token's signature and expiry, then check it was issued for this site.
async function verifyGoogleToken(credential, clientId) {
  const res = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  if (!res.ok) return null;
  const t = await res.json();
  if (t.aud !== clientId || !GOOGLE_ISSUERS.includes(t.iss)) return null;
  if (Number(t.exp) * 1000 < Date.now()) return null;
  if (t.email_verified !== 'true' && t.email_verified !== true) return null;
  return t;
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const clientId = process.env.GOOGLE_CLIENT_ID || '';

  if (req.method === 'GET') {
    let user = null, record = null;
    try { user = readUser(req); } catch (e) {}
    if (user) { try { record = await getRecord(user.email); } catch (e) {} }
    return res.status(200).json({ clientId, user: publicUser(user, record) });
  }

  if (req.headers['x-requested-with'] !== 'jabiru-site') return res.status(403).json({ error: 'Forbidden' });

  if (req.method === 'DELETE') {
    res.setHeader('Set-Cookie', clearUserCookie());
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'PATCH') {
    const user = readUser(req);
    if (!user) return res.status(401).json({ error: 'Please sign in again.' });
    const yes = (req.body || {}).consent === true;
    try {
      const record = (await getRecord(user.email)) || { name: user.name, picture: user.picture, provider: 'google' };
      record.consent = yes || !!record.consent;
      record.optinAsked = true;
      const now = new Date().toISOString();
      const cmds = [['HSET', 'users', user.email, JSON.stringify(record)]];
      if (yes) cmds.push(['HSETNX', 'subscribers', user.email, JSON.stringify({ at: now, source: 'google', consent: true })]);
      await redis(cmds);
      return res.status(200).json({ ok: true });
    } catch (e) {
      console.error(e);
      return res.status(500).json({ error: 'Could not save your choice. Please try again.' });
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!clientId) return res.status(503).json({ error: 'Google sign-in is not set up yet.' });

  const { credential = '', consent = false } = req.body || {};
  if (typeof credential !== 'string' || credential.length < 100 || credential.length > 4096) {
    return res.status(400).json({ error: 'Sign-in failed. Please try again.' });
  }

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const ipKey = 'rl:account:' + crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);

  try {
    const [count] = await redis([['INCR', ipKey], ['EXPIRE', ipKey, 3600, 'NX']]);
    if (count > PER_HOUR) return res.status(429).json({ error: 'Too many attempts. Please try again later.' });

    const t = await verifyGoogleToken(credential, clientId);
    if (!t) return res.status(401).json({ error: 'Google could not confirm your sign-in. Please try again.' });

    const email = String(t.email).toLowerCase();
    const picture = /^https:\/\/[a-z0-9.-]+\.googleusercontent\.com\//i.test(t.picture || '') ? t.picture : '';
    const name = String(t.name || t.given_name || email.split('@')[0]).slice(0, 80);
    const now = new Date().toISOString();

    const [existing] = await redis([['HGET', 'users', email]]);
    let prev = {};
    try { prev = existing ? JSON.parse(existing) : {}; } catch (e) {}
    const record = {
      sub: t.sub, name, picture, provider: 'google',
      firstSeen: prev.firstSeen || now, lastSeen: now,
      consent: prev.consent || consent === true,
      optinAsked: prev.optinAsked || consent === true,
    };
    const cmds = [['HSET', 'users', email, JSON.stringify(record)]];
    if (consent === true) {
      cmds.push(['HSETNX', 'subscribers', email, JSON.stringify({ at: now, source: 'google', consent: true })]);
    }
    await redis(cmds);

    const user = { name, email, picture };
    res.setHeader('Set-Cookie', makeUserCookie(user));
    return res.status(200).json({ ok: true, user: publicUser(user, record) });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Sign-in is not available right now. Please try again later.' });
  }
};
