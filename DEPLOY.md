# Deploy SAATHI for free: shareable link (Render + Netlify)

Result: `https://<your-site>.netlify.app` that anyone can open. No domain purchase needed. ~15 minutes.

> **Honest status:** the configuration files here were checked locally (the backend starts in production mode on an empty database, migrates, seeds and serves logins),
> but the actual Render/Netlify deployments could not be performed from the authoring environment. If a step differs on their dashboards, the settings below tell you what is needed.
> Use this only with the **synthetic demo data**; do not enter real beneficiary information (see `docs/security_and_privacy.md`).

## 0. Put the code on GitHub (Render needs a repository)
Easiest without Git: install **GitHub Desktop**, "Add local repository" → this folder → Publish (it respects `.gitignore`, so `.env` and databases are NOT uploaded).
Or with Git: see "Publishing to GitHub" in `README.md`.

## 1. Backend + database on Render (free)
1. Sign up at render.com with GitHub.
2. **New → Blueprint** → select your SAATHI repo. Render reads `render.yaml` and proposes a web service `saathi-api` and a PostgreSQL database `saathi-db`.
3. When asked, enter three **strong** passwords: `SEED_ADMIN_PASSWORD`, `SEED_CASEWORKER_PASSWORD`, `SEED_BENEFICIARY_PASSWORD` (you will share these with reviewers).
4. Click **Apply**. The first deploy takes ~5–8 minutes. On start the app migrates the database and loads the synthetic demo data automatically (only when the database is empty).
5. Open `https://saathi-api.onrender.com/api/health` → should show `{"status":"ok",…}`.
   If Render gave the service a different name/URL (e.g. `saathi-api-x1y2.onrender.com`), use that URL in step 2 below.

## 2. Frontend on Netlify (free)
Option A – drag and drop (no Git needed):
1. On your PC: `cd frontend`, `npm ci`, `npm run build`.
2. Open app.netlify.com → **Add new site → Deploy manually** → drag the `frontend/dist` folder in.
3. If your Render URL is not `saathi-api.onrender.com`, edit `frontend/public/_redirects` first (replace the hostname), then rebuild.

Option B – from GitHub: Netlify → **Import from Git** → base directory `frontend` (settings come from `frontend/netlify.toml`; edit the hostname there if needed).

Netlify gives you `https://<random-name>.netlify.app` (rename it under *Site settings → Change site name*). **That is the link to share.**
The file `_redirects`/`netlify.toml` proxies `/api/*` to Render, so the browser only talks to one origin and no CORS setup is needed.

## 3. Share it
Demo mode is on in `render.yaml` (`DEMO_MODE=true`), so reviewers just open the link and click **Beneficiary**, **Caseworker** or **Admin** - no passwords. Set it to `"false"` on Render to require logins again.
Give reviewers the link plus logins: `admin`, `caseworker1`…`caseworker5`, `ben001`…`ben025` with the passwords you chose.

## Things to know
* **Cold starts:** Render's free service sleeps after ~15 min idle; the first request then takes 30–60 s. Open the link yourself a minute before a demo.
* **Free database expiry:** Render's free PostgreSQL is time-limited (currently ~30 days). For a longer-lived demo create a free database at neon.tech and set `DATABASE_URL` on the Render service to its connection string.
* **Reset the demo data:** Render → saathi-api → Shell → `python -m scripts.seed --reset` (or delete and recreate the database).
* **Security:** HTTPS is automatic. Anyone with the link can try to sign in, so use strong seed passwords; accounts lock for 15 minutes after 5 failed attempts.
* **Custom domain (optional):** Netlify → Domain management → add domain.
