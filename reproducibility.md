# Reproducibility

## Pinned inputs
* Python dependencies pinned to exact versions in `backend/requirements.txt`.
* Frontend dependencies pinned exactly in `frontend/package.json`, with `frontend/package-lock.json` (use `npm ci`).
* Database schema from Alembic migration `0001_initial_schema` (`alembic upgrade head`).
* Synthetic data: seed `2026` (`scripts/seed.py`); ML dataset/model seed `42` (`scripts/train_model.py`). Seed *dates* are relative to the day it runs, so timelines
  always look "current"; counts and profile mix are deterministic.

## From a fresh clone (≈5 minutes)
See README sections 8–12. In short: copy `.env.example` → `.env`; create venv; `pip install -r requirements.txt`; `python -m scripts.train_model` (optional);
`python -m scripts.seed --reset`; `uvicorn app.main:app --port 8000`; `cd frontend && npm ci && npm run dev`.

## Verification performed
* Fresh-copy check on 9 Nov 2026: the repository was copied (excluding `.venv`, `node_modules`, `.env`, databases and trained model) to a new folder and the steps above were run
  (`pip install`, `seed --reset`, `pytest`, `npm ci`, `npm run build`). Outcome: dependencies installed, seed succeeded (25 beneficiaries / 84 assessments),
  **47 tests passed + 1 skipped** (the ML-shape test skips because the trained model file is git-ignored and was not trained in the fresh copy), and the frontend built.
* Retraining the ML model with the same seed gave an identical metrics file.

## Not verified
Docker Compose build and run (WSL2 pending reboot); macOS/Linux shells (commands were only executed in Windows PowerShell).

## Resetting
`python -m scripts.seed --reset` — drops all tables and the Alembic version table, re-runs migrations, regenerates the demo data and prints a new demo invitation code.
