// Public endpoint for the landing page email signup. Saves the email in Redis (never in the public repo).
const crypto = require('crypto');
const { redis } = require('./_lib');

const EMAIL = /^[^\s@<>"',;]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
const PER_HOUR = 10; // signups allowed per visitor IP per hour

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (req.headers['x-requested-with'] !== 'jabiru-site') return res.status(403).json({ error: 'Forbidden' });

  const { email = '', consent = false, website = '' } = req.body || {};
  // "website" is a hidden field only bots fill in. Pretend it worked.
  if (website) return res.status(200).json({ ok: true });

  const clean = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (clean.length > 254 || !EMAIL.test(clean)) return res.status(400).json({ error: 'Please enter a valid email address.' });
  if (consent !== true) return res.status(400).json({ error: 'Please tick the box to agree to receive updates.' });

  // Rate limit by a hash of the IP, so the IP itself is never stored.
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const ipKey = 'rl:subscribe:' + crypto.createHash('sha256').update(ip).digest('hex').slice(0, 32);

  try {
    const [count] = await redis([['INCR', ipKey], ['EXPIRE', ipKey, 3600, 'NX']]);
    if (count > PER_HOUR) return res.status(429).json({ error: 'Too many attempts. Please try again later.' });
    const record = JSON.stringify({ at: new Date().toISOString(), source: 'landing', consent: true });
    await redis([['HSETNX', 'subscribers', clean, record]]);
    // Same reply whether the email is new or already on the list.
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Signup is not available right now. Please try again later.' });
  }
};
