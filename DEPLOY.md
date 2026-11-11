# Hosting SAATHI

There are two ways to host it. **Option A needs only Netlify and no server.**

| | Option A: static demo (recommended for a prototype link) | Option B: full stack |
|---|---|---|
| What runs | The React app plus an in-browser copy of the API and rules engine | React app + FastAPI + PostgreSQL |
| Accounts needed | Netlify (free) | Netlify + Render (free tiers) |
| Data | Synthetic, stored in each visitor's browser | Synthetic or real, stored in a shared database |
| Backend features (real JWT security, shared data, ML advisory) | Not included | Included |
| Use with real data | **No** | Only after the security and legal steps in `docs/security_and_privacy.md` |

---

## Option A: Netlify only (static demo)

1. Put the project on GitHub (see `README.md`, "Publishing to GitHub").
2. Sign in at **app.netlify.com** and choose **Add new site → Import an existing project → GitHub**, then pick the repository.
3. Set **Base directory** to `frontend`. Netlify reads `frontend/netlify.toml` automatically:
   - build command `npm run build`
   - publish directory `dist`
   - environment variable `VITE_STATIC_DEMO=true` (this switches the app to its built-in demo API)
   - single-page-app fallback so deep links work
4. Click **Deploy**. After about a minute Netlify shows a link such as `https://random-name.netlify.app`. Rename it under *Site configuration → Change site name*. **That is the link to share.**

No-Git alternative: on your PC run `cd frontend`, `npm ci`, then build with the demo flag
(PowerShell: `$env:VITE_STATIC_DEMO="true"; npm run build`) and drag the `frontend/dist` folder onto Netlify's **Add new site → Deploy manually** page.

The login page is **demo-only**: visitors click **Beneficiary**, **Caseworker** or **Admin**, with no username or password, under a clear "Demo prototype" notice. A banner explains that data stays in their own browser; **Reset demo data** restores the sample data.

Local check before deploying: `$env:VITE_STATIC_DEMO="true"; npm run build; npx vite preview`.

---

## Option B: full stack (Render + Netlify)

Use this when you want the real FastAPI backend and a shared database.

### B1. Backend and database on Render
1. Put the code on GitHub, then create a free account at render.com (sign up with GitHub).
2. **New → PostgreSQL** (Free plan). Copy its **Internal Database URL**.
3. **New → Web Service**, pick the repo, then set:
   - Root Directory: `backend`
   - Build Command: `pip install -r requirements-postgres.txt`
   - Start Command: `python -m scripts.bootstrap && uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - Instance type: Free
4. Environment variables (use **Add from .env**): `PYTHON_VERSION=3.12.4`, `APP_ENV=production`, `DEMO_MODE=true` (one-click roles, synthetic data only), `CORS_ORIGINS=https://example.netlify.app`, `SEED_ADMIN_USERNAME=admin`, the three `SEED_*_PASSWORD` values, `DATABASE_URL` (the URL from step 2) and a `SECRET_KEY` of at least 32 random characters.
5. Deploy and open `https://<your-service>.onrender.com/api/health`; it should answer `{"status":"ok",...}`. On first start the app migrates the database, loads the synthetic demo data once, and trains the optional ML model.

(`render.yaml` in the repository describes the same service and database as a Blueprint.)

### B2. Frontend on Netlify, pointing at the API
Build the frontend **without** the static flag and add a rewrite that sends `/api/*` to Render. Create `frontend/public/_redirects` containing

```
/api/*  https://<your-service>.onrender.com/api/:splat  200
/*      /index.html                                     200
```

and in the Netlify site settings set `VITE_STATIC_DEMO` to `false` (or delete it from `netlify.toml`), then build and deploy as in Option A.

### Login mode
The frontend login page is demo-only (three role buttons, no username or password) unless built with `VITE_LOGIN_MODE=full`, which restores the normal username/password form and invitation-code registration for real deployments. The demo buttons call `POST /api/auth/demo-login`, so the backend needs `DEMO_MODE=true`. The first click after the free Render server has been idle can take up to a minute; the page shows a progress message.

### Things to know (Option B)
* Render's free web service sleeps after about 15 minutes idle; the first request then takes 30 to 60 seconds.
* Render's free PostgreSQL is time-limited. For a longer-lived demo use a free database at neon.tech and set `DATABASE_URL` to its connection string.
* Reset the demo data from Render's Shell with `python -m scripts.seed --reset`.
* Anyone with the link can use demo mode, so keep real data out of it.
