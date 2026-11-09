# SAATHI — Smart AI-Assisted Trauma and Holistic Intervention

> **Decision-support and early-warning prototype — not a diagnostic system.**
> It never diagnoses any condition, never labels anyone permanently, and every flag is reviewed by an authorised human.
> All demonstration data is **synthetic**.

AI-assisted dynamic mental-health monitoring and distress-prediction prototype for victims of atrocities.
SIH Problem ID **SIH26094** · Ministry of Social Justice and Empowerment (MoSJE), Government of India · Domain: MedTech / HealthTech.

---

## 1. Project overview
SAATHI lets beneficiaries complete short, non-stigmatising well-being check-ins; an **explainable rule-based engine** turns each check-in
(plus its change from earlier check-ins) into a *review-priority* recommendation — **Routine / Attention / Urgent review** — and notifies the
assigned caseworker, who manages follow-ups, interventions and notes. Administrators see only aggregated, small-cell-suppressed analytics.

## 2. Problem statement
Support organisations need a secure, privacy-conscious way to notice early signs of psychological distress among beneficiaries, monitor
self-reported well-being over time, and prioritise scarce human follow-up. See `docs/system_architecture.md` for how SAATHI addresses this.

## 3. Key features
| Area | What is implemented |
|---|---|
| Roles | Beneficiary, Caseworker, Administrator — RBAC enforced on the **backend** |
| Check-in | 17-item prototype questionnaire (Likert, multiple-choice, optional free text), consent gate, save & resume, validation |
| Engine | Transparent, configurable, explainable rules; missing-data handling; change-vs-previous; persistence; critical-item rules; optional experimental ML advisory (synthetic-trained) |
| Monitoring | Per-person timeline, dimension trends, review notifications for the assigned caseworker |
| Case management | Search/filter/sort/paginate cases, single-screen case profile, notes, follow-ups (incl. beneficiary requests), interventions + outcomes, status |
| Admin | Users & roles, assignment, invitations (authorised onboarding), engine configuration, resources & emergency contacts, audit log, retention, erasure |
| Analytics | Completion rates, priority distribution, trends, follow-up & intervention stats — aggregate only, consent-aware, small-cell suppression |
| Privacy | Consent records, audit logging, least-privilege access, data export, deletion request + admin erasure, retention job |

## 4. Technology stack
React · TypeScript · Vite · Tailwind CSS · Recharts · React Router · Axios · Lucide — FastAPI · SQLAlchemy 2 · Pydantic 2 · Alembic · PyJWT · bcrypt —
SQLite (default, PostgreSQL-compatible schema) — pandas · NumPy · scikit-learn — pytest · Vitest · Playwright — Docker / Docker Compose.
No paid or external AI services are used.

## 5. Architecture overview
```
Browser (React SPA) ──HTTPS/JSON──> FastAPI ──> SQLAlchemy ──> SQLite / PostgreSQL
                                       │
                                       └── app/engine  (questionnaire • rule scoring • optional ML advisory)
```
Details and diagrams: [docs/system_architecture.md](docs/system_architecture.md).

## 6. Folder structure
```
SAATHI/
├── backend/
│   ├── app/            main.py, config, database, models, schemas, security, deps
│   │   ├── engine/     questionnaire.py, config.py, scoring.py, ml.py, synthetic.py   ← assessment engine
│   │   ├── routers/    auth, beneficiaries, cases, assessments, followups, interventions, analytics, admin, me
│   │   └── services/   audit, cases, assessment_service, settings_service
│   ├── alembic/        migrations         scripts/  seed.py, train_model.py
│   ├── models/         ml_metrics.json (+ ml_advisory.joblib after training)      tests/  pytest suite
├── frontend/           src/{pages,components,api,auth}, e2e/ (Playwright), Dockerfile, nginx.conf
├── docs/               architecture, DB, API, methodology, security, testing, reproducibility, future scope
├── docker-compose.yml  .env.example  README.md
```

## 7. Prerequisites
Python 3.11+ (tested 3.12) · Node.js 20+ (tested 26) · npm. Optional: Docker Desktop, a Chromium-based browser (for e2e).

## 8–11. Installation, environment, database, seed data
Windows PowerShell shown; on macOS/Linux use `source .venv/bin/activate` and `cp`.

```powershell
git clone <your-repo-url> SAATHI; cd SAATHI
Copy-Item .env.example .env            # then edit SECRET_KEY and the SEED_* demo passwords
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m scripts.train_model          # optional: trains the experimental ML advisory on synthetic data
python -m scripts.seed --reset         # ONE command: drops tables, runs Alembic migrations, loads synthetic demo data
```
`python -m scripts.seed --reset` reads the three demo passwords from `.env` (`SEED_ADMIN_PASSWORD`, `SEED_CASEWORKER_PASSWORD`,
`SEED_BENEFICIARY_PASSWORD`) and prints a single-use demo invitation code. Re-run it any time to regenerate the demo environment.
To migrate without seeding: `alembic upgrade head`.

Seed contents: 25 beneficiaries, 5 caseworkers (one per organisational unit), 1 admin, ~85 assessments over multiple timelines
(stable-low, stable-mid, stable-high, improving, declining, volatile), follow-ups (completed / upcoming / overdue / requested),
interventions with outcomes, notes, and 12 resources. Every record is flagged `is_synthetic`.

### Environment variables (`.env`)
| Variable | Purpose |
|---|---|
| `SECRET_KEY` | JWT signing key. **Must** be ≥32 random chars when `APP_ENV=production` (the app refuses to start otherwise) |
| `DATABASE_URL` | `sqlite:///./saathi.db` (default) or `postgresql+psycopg2://user@host:5432/saathi` (install with `pip install -r requirements-postgres.txt`). PostgreSQL 16 verified, see below |
| `CORS_ORIGINS` | Allowed browser origins |
| `ACCESS_TOKEN_MINUTES`, `RETENTION_FREE_TEXT_DAYS`, `ANALYTICS_MIN_CELL` | Token lifetime, free-text retention, small-cell suppression threshold |
| `SEED_ADMIN_USERNAME`, `SEED_*_PASSWORD` | Demo credentials for the seed script (never hard-coded) |

## 12. Running
Terminal 1 (API, http://localhost:8000 — Swagger UI at `/docs`):
```powershell
cd backend; .\.venv\Scripts\Activate.ps1; uvicorn app.main:app --reload --port 8000
```
Terminal 2 (UI, http://localhost:5173 — proxies `/api` to the API):
```powershell
cd frontend; npm install; npm run dev
```

### PostgreSQL
Verified on PostgreSQL 16.2: migrations, seed, the full pytest suite (`TEST_DATABASE_URL=postgresql+psycopg2://... pytest`, **drops that database's tables**) and the live API audit all pass. Run the audit yourself with the server running and a freshly seeded DB: `python -m scripts.audit_api`, restart the server, then `python -m scripts.audit_api_phase2`.

## 13. Tests
```powershell
cd backend;  .\.venv\Scripts\python -m pytest -q                 # 48 tests (engine units + API/RBAC/privacy integration)
cd frontend; npm test                                           # 7 Vitest tests
# End-to-end (API + seeded data must be running; uses the installed Edge/Chrome, no download):
$env:E2E_BENEFICIARY_PASSWORD="<SEED_BENEFICIARY_PASSWORD>"; $env:E2E_CASEWORKER_PASSWORD="<SEED_CASEWORKER_PASSWORD>"; $env:E2E_ADMIN_PASSWORD="<SEED_ADMIN_PASSWORD>"
npm run e2e                                                     # 37 Playwright tests (~10 min; they modify the demo DB, so re-run `python -m scripts.seed --reset` afterwards). Set E2E_BROWSER_CHANNEL=chrome|chromium to change browser
```
Results recorded at the time of writing are in [docs/testing_strategy.md](docs/testing_strategy.md).

## 14. Docker
```bash
docker compose up --build                                  # UI http://localhost:8080 · API http://localhost:8000/docs
docker compose run --rm api python -m scripts.seed --reset # first run: load synthetic demo data into the volume
```
> The Docker files have been reviewed by reading but **not yet executed**: Docker Desktop was installed in the authoring environment but its engine needs WSL2 plus a reboot.
> Please run them once and report problems; see Troubleshooting.

### Hosting a public demo
Free shareable link without buying a domain (Render for API + database, Netlify for the UI): see [DEPLOY.md](DEPLOY.md).

### Demo mode (no passwords)
Set `DEMO_MODE=true` (already set in your local `.env` and in `render.yaml`) and the login page shows **Beneficiary / Caseworker / Admin** buttons that sign in as the seeded synthetic accounts with one click. It is off by default.
Safeguards: the endpoint only works for accounts flagged `is_synthetic`; shared demo accounts cannot be deactivated, re-roled, password-changed or erased, and logging out does not sign out other visitors. Never enable it with real data.

## 15. Demo credentials
There are no hard-coded credentials. After seeding, sign in with the passwords you put in `.env`:
| Role | Username |
|---|---|
| Administrator | `admin` (or `SEED_ADMIN_USERNAME`) |
| Caseworkers | `caseworker1` … `caseworker5` (each has 5 assigned cases) |
| Beneficiaries | `ben001` … `ben025` (ben001, ben006, … belong to caseworker1) |
To demo onboarding, use the invitation code printed by the seed script on the sign-in page ("I have an invitation code"), or generate one in Admin → Onboarding.

## 16. Known limitations
* The questionnaire is an **original prototype, not a validated clinical instrument**; thresholds are illustrative, not clinically calibrated.
* The ML component is trained **only on synthetic data** that encodes our own assumptions; its metrics demonstrate nothing about real-world validity.
* Free-text answers are stored and shown to caseworkers but are **not analysed** automatically.
* Emergency/support contacts seeded for the demo are **unverified placeholders** — an administrator must verify them before any real use.
* Notifications are in-app only (no SMS/e-mail). No external messaging occurs by design.
* Tokens are kept in `sessionStorage` (XSS trade-off documented in `docs/security_and_privacy.md`); no refresh tokens, MFA or e-mail password reset.
* Case lists are computed in Python per request (fine for hundreds of cases; needs SQL aggregation at larger scale).
* Docker artefacts have not yet been executed (the engine could not start until WSL2 is enabled and the machine rebooted). No legal/privacy review has been performed.

## 17. Future development
See [docs/future_scope.md](docs/future_scope.md): clinical validation with domain experts, multilingual UI, MFA, field-level encryption, SMS/WhatsApp
reminders under consent, offline-first mobile app, fairness auditing, proper background jobs.

## Troubleshooting
| Symptom | Fix |
|---|---|
| `Missing environment variables: SEED_…` | Create `.env` from `.env.example` in the repo root |
| `Database already contains users` | Re-run with `--reset` |
| Frontend shows "Cannot reach the server" | Start the API on port 8000 (the Vite dev server proxies `/api`) |
| `Activate.ps1 cannot be loaded` (PowerShell) | `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`, or call `.\.venv\Scripts\python` directly |
| 429 "Too many failed attempts" | Account locked 15 min after 5 bad logins; re-seed or wait |
| ML advisory missing | Run `python -m scripts.train_model` (app works without it) |
| `node` not found after install | Open a new terminal so PATH refreshes |

## Publishing to GitHub
Git was not available in the authoring environment, so nothing has been pushed. To publish:
```bash
git init && git add . && git commit -m "SAATHI prototype"
git branch -M main
git remote add origin https://github.com/<you>/saathi.git
git push -u origin main
```
`.gitignore` already excludes `.env`, databases, `node_modules`, virtual-envs and trained model binaries. Check `git status` shows no `.env` before pushing.
