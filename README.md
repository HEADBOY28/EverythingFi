# EverythingFi 🌐

A Web3 app directory: apps organized by category, with a password-protected admin page.

## How it works

- `index.html`: the landing page at `/`. Intro text, Connect wallet and social links. The headline, intro and links are edited in the admin page under **Branding**.
- `app.html`: the public, read-only app directory at `/app`. It loads the apps from `data/site.json`.
- `admin.html`: the admin page at `/admin`. Sign in with your username and password to add, edit and delete apps, manage categories and branding.
- `api/`: small Vercel serverless functions for login and publishing. When you click **Publish** in the admin page, the changes are committed to this repo and Vercel redeploys the site automatically.
- `icons/`: app logos.

## Setup on Vercel

Add these in **Vercel → Project → Settings → Environment Variables**, then redeploy:

| Name | Value |
| --- | --- |
| `ADMIN_USERNAME` | Your admin username |
| `ADMIN_PASSWORD` | A long, unique password |
| `SESSION_SECRET` | A long random string (e.g. run `openssl rand -hex 32`) |
| `GITHUB_TOKEN` | A fine-grained GitHub token with **Contents: Read and write** on this repo only |
| `GITHUB_REPO` | `HEADBOY28/EverythingFi` (optional, this is the default) |

Credentials never appear in the code. The admin page only works on Vercel (not GitHub Pages), because it needs the `api/` functions.

## Local preview

Run `python3 -m http.server` in this folder and open http://localhost:8000. Opening the HTML files directly will not load the apps. Locally the directory is at http://localhost:8000/app.html (on Vercel it's `/app`).

---

Built by [@headboy28](https://github.com/headboy28)
