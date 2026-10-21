// Publishes admin changes: commits data/site.json (and any new logos) to GitHub in one commit.
// Vercel sees the commit and redeploys the site automatically.
const { requireAdmin, gh, headSha, branch } = require('./_lib');

const ICON_PATH = /^icons\/[A-Za-z0-9_-]{1,64}\.(png|jpg|jpeg|webp|gif|svg)$/;
const UPLOAD_PATH = /^icons\/[A-Za-z0-9_-]{1,64}\.(png|jpg|webp|gif)$/; // no new SVGs: they can carry scripts
const UPLOAD_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

function str(v, max) {
  return typeof v === 'string' && v.length <= max ? v.trim() : null;
}

function cleanIcon(icon) {
  if (typeof icon !== 'string') return '🔗';
  if (ICON_PATH.test(icon)) return icon;
  return [...icon].length <= 8 && !/[<>"'&]/.test(icon) ? icon : null;
}

function validate(site) {
  if (!site || typeof site !== 'object') throw new Error('Missing data');
  const apps = site.apps;
  if (!Array.isArray(apps) || apps.length > 3000) throw new Error('Invalid app list');
  const ids = new Set();
  const cleanApps = apps.map((a, i) => {
    const where = `App #${i + 1}`;
    if (!a || typeof a !== 'object') throw new Error(where + ' is invalid');
    const id = Number(a.id);
    if (!Number.isSafeInteger(id) || ids.has(id)) throw new Error(where + ' has a bad or duplicate id');
    ids.add(id);
    const name = str(a.name, 100);
    const url = str(a.url, 2000);
    const desc = str(a.desc || '', 500);
    const cat = str(a.cat, 60);
    const icon = cleanIcon(a.icon);
    if (!name) throw new Error(where + ' needs a name');
    if (!url || !/^https?:\/\/[^\s]+$/i.test(url)) throw new Error(`"${name}" needs a valid http(s) URL`);
    if (desc === null) throw new Error(`"${name}" description is too long`);
    if (!cat) throw new Error(`"${name}" needs a category`);
    if (icon === null) throw new Error(`"${name}" has an invalid icon`);
    return { id, name, url, desc, cat, icon };
  });
  if (!Array.isArray(site.catOrder) || site.catOrder.length > 200) throw new Error('Invalid category list');
  const catOrder = [...new Set(site.catOrder.map((c) => str(c, 60)).filter(Boolean))];
  const b = site.brand || {};
  const brand = {
    name: str(b.name, 40) || 'EverythingFi',
    logoEmoji: cleanIcon(b.logoEmoji || '🗂') || '🗂',
    logoImage: b.logoImage && ICON_PATH.test(b.logoImage) ? b.logoImage : null,
  };
  return { brand, catOrder, apps: cleanApps };
}

function decodeUploads(uploads, site) {
  if (!uploads) return [];
  if (typeof uploads !== 'object') throw new Error('Invalid uploads');
  const used = new Set(site.apps.map((a) => a.icon).concat(site.brand.logoImage || []));
  return Object.entries(uploads)
    .filter(([path]) => used.has(path)) // skip images that ended up unused
    .map(([path, dataUrl]) => {
      if (!UPLOAD_PATH.test(path)) throw new Error('Invalid image name: ' + path);
      const ext = path.split('.').pop();
      const m = typeof dataUrl === 'string' && dataUrl.match(/^data:([a-z/+]+);base64,([A-Za-z0-9+/=]+)$/);
      if (!m || m[1] !== UPLOAD_TYPES[ext]) throw new Error('Images must be PNG, JPG, WEBP or GIF');
      const bytes = Buffer.from(m[2], 'base64');
      if (bytes.length > MAX_UPLOAD_BYTES) throw new Error('Each image must be under 2MB');
      return { path, base64: m[2] };
    });
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const session = requireAdmin(req, res);
  if (!session) return;

  let site, images;
  try {
    site = validate(req.body && req.body.site);
    images = decodeUploads(req.body.uploads, site);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  try {
    const current = await headSha();
    if (req.body.baseSha && req.body.baseSha !== current) {
      return res.status(409).json({ error: 'The site was changed somewhere else since you loaded it. Reload the admin page and try again.' });
    }
    const baseCommit = await gh('/git/commits/' + current);

    const tree = [{
      path: 'data/site.json', mode: '100644', type: 'blob',
      content: JSON.stringify(site, null, 1) + '\n',
    }];
    for (const img of images) {
      const blob = await gh('/git/blobs', { method: 'POST', body: JSON.stringify({ content: img.base64, encoding: 'base64' }) });
      tree.push({ path: img.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const newTree = await gh('/git/trees', { method: 'POST', body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }) });
    const commit = await gh('/git/commits', {
      method: 'POST',
      body: JSON.stringify({ message: `Update apps via admin page (${session.u})`, tree: newTree.sha, parents: [current] }),
    });
    await gh('/git/refs/heads/' + encodeURIComponent(branch()), {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha, force: false }),
    });
    return res.status(200).json({ ok: true, sha: commit.sha });
  } catch (e) {
    console.error(e);
    if (e.status === 422) return res.status(409).json({ error: 'The site changed while publishing. Reload the admin page and try again.' });
    return res.status(502).json({ error: 'Publishing to GitHub failed. Check GITHUB_TOKEN has write access to the repo.' });
  }
};
