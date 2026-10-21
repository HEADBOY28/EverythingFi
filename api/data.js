// Returns the latest site data straight from GitHub (newer than the deployed copy right after a publish).
const { requireAdmin, gh, headSha } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const session = requireAdmin(req, res);
  if (!session) return;
  res.setHeader('Cache-Control', 'no-store');
  try {
    const sha = await headSha();
    const text = await gh('/contents/data/site.json?ref=' + sha, { accept: 'application/vnd.github.raw' });
    return res.status(200).json({ sha, username: session.u, site: JSON.parse(text) });
  } catch (e) {
    console.error(e);
    return res.status(502).json({ error: 'Could not load data from GitHub. Check GITHUB_TOKEN and GITHUB_REPO.' });
  }
};
