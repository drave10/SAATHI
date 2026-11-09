# Implementation checklist

Legend: ✅ done and exercised · ⚠️ done but not executed in the authoring environment · ❌ not done

## Phase 1 – Planning
- ✅ Architecture, folder structure, schema, API contracts (`docs/`)

## Phase 2 – Backend
- ✅ FastAPI app, config from env, SQLAlchemy 2 models, Alembic migration
- ✅ JWT auth, bcrypt, lockout, token revocation, invitation-based onboarding
- ✅ RBAC (role + object level), audit logging
- ✅ Assessment APIs (draft/resume/submit/history/detail/compare/explanation/recalculate/review)
- ✅ Assessment engine (rules, configurable, explainable, missing data, history) in `app/engine`
- ✅ Experimental ML advisory + reproducible synthetic training script + metrics
- ✅ Case management, follow-ups, interventions, alerts, analytics, admin, consent/export/erasure/retention
- ✅ Seed system (25 beneficiaries, 5 caseworkers, ~85 assessments) with single reset command
- ✅ 48 backend tests

## Phase 3 – Frontend (all 14 requested pages)
- ✅ Landing/Login (+ invitation registration) · Beneficiary dashboard · Assessment · History · Trends · Support resources
- ✅ Caseworker dashboard · Case details · Follow-up management · Intervention records
- ✅ Admin dashboard (overview/assignments, engine config, resources & emergency contacts, onboarding & deletion, audit log) · User management · Analytics
- ✅ Settings & privacy (consent, export, deletion request, password)
- ✅ Loading / error / empty states; responsive layout (sidebar → hamburger); keyboard-accessible forms, labelled controls
- ✅ Vitest (7) · type-check · production build
- ✅ Integration audit: no mock data in UI; org units and audit actions come from the API; phone overflow and swallowed-error bugs fixed

## Phase 4–5 – Integration & QA
- ✅ Playwright e2e (37) against real API + DB: all user workflows, navigation, responsive (375/768/1280 px), loading/error states
- ✅ Role restrictions verified in API tests and e2e
- ✅ ML retrain reproducibility
- ⚠️ Dockerfiles / docker-compose written and reviewed, **not yet built or run** (Docker Desktop installed; WSL2 needs a reboot)
- ✅ PostgreSQL 16.2: migrations, seed, 48 pytest, live audit (247 checks) all pass
- ✅ Live API audit of all 60 operations on SQLite and PostgreSQL, incl. persistence across restart
- ❌ Automated accessibility audit, load tests, penetration test

## Phase 6 – Finalisation
- ✅ README, 9 technical docs, `.env.example`, `.gitignore`
- ⚠️ GitHub publication: **not done** (Git unavailable; nothing has been pushed)
