const { env, safeEqual, makeSessionCookie } = require('./_lib');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (req.headers['x-requested-with'] !== 'everythingfi-admin') return res.status(403).json({ error: 'Forbidden' });

  let expectedUser, expectedPass;
  try {
    expectedUser = env('ADMIN_USERNAME');
    expectedPass = env('ADMIN_PASSWORD');
    env('SESSION_SECRET');
  } catch (e) {
    return res.status(500).json({ error: 'Admin login is not configured yet. Add the environment variables in Vercel.' });
  }

  const { username = '', password = '' } = req.body || {};
  // Check both fields every time so timing does not reveal which one was wrong.
  const userOk = safeEqual(username, expectedUser);
  const passOk = safeEqual(password, expectedPass);

  if (!(userOk && passOk)) {
    await new Promise((r) => setTimeout(r, 1500)); // slow down guessing
    return res.status(401).json({ error: 'Wrong username or password' });
  }

  res.setHeader('Set-Cookie', makeSessionCookie(expectedUser));
  return res.status(200).json({ ok: true, username: expectedUser });
};
