// Admin only: list email subscribers (GET) or remove one (DELETE ?email=...).
const { requireAdmin, redis } = require('./_lib');

module.exports = async (req, res) => {
  const session = requireAdmin(req, res);
  if (!session) return;
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (req.method === 'GET') {
      const [flat] = await redis([['HGETALL', 'subscribers']]);
      const list = [];
      for (let i = 0; i < (flat || []).length; i += 2) {
        let info = {};
        try { info = JSON.parse(flat[i + 1]); } catch (e) {}
        list.push({ email: flat[i], at: info.at || '', source: info.source || '' });
      }
      list.sort((a, b) => (a.at < b.at ? 1 : -1));
      return res.status(200).json({ subscribers: list });
    }
    if (req.method === 'DELETE') {
      const email = String((req.query && req.query.email) || '').trim().toLowerCase();
      if (!email) return res.status(400).json({ error: 'Missing email' });
      await redis([['HDEL', 'subscribers', email]]);
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: 'Could not reach the subscriber database. Check the Upstash Redis setup in Vercel.' });
  }
};
