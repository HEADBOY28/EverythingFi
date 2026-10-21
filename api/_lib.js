// Shared helpers for the admin API. Files starting with "_" are not exposed as routes on Vercel.
const crypto = require('crypto');

const COOKIE = 'ef_admin';
const SESSION_HOURS = 8;

function env(name, fallback) {
  const v = process.env[name];
  if (v) return v;
  if (fallback !== undefined) return fallback;
  throw new Error('Missing environment variable: ' + name);
}

function hmac(data) {
  return crypto.createHmac('sha256', env('SESSION_SECRET')).update(data).digest('base64url');
}

// Compare two strings in constant time (hashing first so lengths always match).
function safeEqual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function makeSessionCookie(username) {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: Date.now() + SESSION_HOURS * 3600e3 })).toString('base64url');
  const value = payload + '.' + hmac(payload);
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
}

function clearSessionCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function readSession(req) {
  const header = req.headers.cookie || '';
  const match = header.split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
  if (!match) return null;
  const [payload, sig] = match.slice(COOKIE.length + 1).split('.');
  if (!payload || !sig || !safeEqual(sig, hmac(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return data.exp > Date.now() ? data : null;
  } catch (e) {
    return null;
  }
}

// Every admin request must carry a valid session and come from our own page.
function requireAdmin(req, res) {
  if (req.headers['x-requested-with'] !== 'everythingfi-admin') {
    res.status(403).json({ error: 'Forbidden' });
    return null;
  }
  const session = readSession(req);
  if (!session) {
    res.status(401).json({ error: 'Not signed in' });
    return null;
  }
  return session;
}

// ── GitHub ──
function repo() { return env('GITHUB_REPO', 'HEADBOY28/EverythingFi'); }
function branch() { return env('GITHUB_BRANCH', 'main'); }

async function gh(path, options = {}) {
  const res = await fetch('https://api.github.com/repos/' + repo() + path, {
    ...options,
    headers: {
      Authorization: 'Bearer ' + env('GITHUB_TOKEN'),
      Accept: options.accept || 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
      'User-Agent': 'everythingfi-admin',
    },
  });
  if (!res.ok) {
    const err = new Error('GitHub ' + res.status + ': ' + (await res.text()).slice(0, 300));
    err.status = res.status;
    throw err;
  }
  return options.accept && options.accept.endsWith('raw') ? res.text() : res.json();
}

async function headSha() {
  const ref = await gh('/git/ref/heads/' + encodeURIComponent(branch()));
  return ref.object.sha;
}

module.exports = {
  env, safeEqual, makeSessionCookie, clearSessionCookie, readSession, requireAdmin,
  gh, headSha, branch,
};
