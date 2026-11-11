# Testing strategy

## Layers
| Layer | Tool | Location | What it proves |
|---|---|---|---|
| Engine unit tests | pytest | `backend/tests/test_engine.py` (17) | Each rule: routine/attention/urgent, critical self-harm item (even with sparse data), missing-data handling, exclusion of unanswered items from scores, help-request levels, rise/sharp-rise/persistence, configurability, config validation, no demographic inputs, ML optional |
| API / integration | pytest + FastAPI `TestClient` on a temporary SQLite DB seeded with the real seed function | `backend/tests/test_api.py` (31) | Auth (login, bad login, lockout, logout revokes token, change password, invitation-only registration with consent), **RBAC** (role gates, caseworker isolation → 404, admin cannot read clinical content, beneficiary cannot read others), assessment workflow (consent gate, validation, save/resume, submit, double submit 409, urgent alert + resources, beneficiary never sees review level), follow-ups, interventions, notes, case list filters/sort/pagination, caseworker dashboard, admin analytics (aggregate-only, small-cell suppression), user management, assignment, engine-config validation, resources, audit log, consent/export/erasure, retention, headers, error format, seed requirements |
| Frontend unit | Vitest + Testing Library | `frontend/src/test/app.test.tsx` (15) and `frontend/src/demo/demo.test.ts` (11) | Priority badge wording, pagination, empty state, error-message mapping, login shows server error (no fake success), consent gating of registration, non-diagnostic disclaimer |
| End-to-end | Playwright (system Edge/Chrome) | `frontend/e2e/*.spec.ts` (37) | Bad login error; full beneficiary check-in with a critical answer → support panel (no risk label) → caseworker sees notification and explanation; UI + API role restriction; admin analytics shows no identifiers |

## Method
* Tests run against the real application code and database (no mocked endpoints), with bcrypt rounds lowered by `BCRYPT_ROUNDS=4` only in tests.
* The API suite shares one seeded DB per session; assertions use `>=`/ranges where earlier tests legitimately add data (e.g. a registered user).
* Frontend tests mock only the network boundary (`axios`) and check that errors surface rather than succeed silently.
* E2E needs the API with seeded data running; credentials come from environment variables, not the repo.

## Results recorded on 9 Nov 2026 (Windows 11, Python 3.12.4, Node 26.13)
| Suite | Result |
|---|---|
| `pytest` (backend) | **48 passed** |
| `vitest run` | **26 passed** (15 UI/login incl. the demo-only login page and its retry behaviour, 11 in-browser API) |
| `tsc -b` (type check) | no errors |
| `npm run build` | succeeds |
| `playwright test` | **37 end-to-end tests**, see "Frontend–backend integration audit" below (Microsoft Edge channel) |
| ML training reproducibility | re-running `train_model` produced byte-identical `ml_metrics.json` |

## Live API audit (`backend/scripts/audit_api.py`, `audit_api_phase2.py`)
Black-box script against a running server: exercises **all 60 API operations** from `/openapi.json` (reports any not exercised), a role matrix, validation errors, and reads the database directly after writes.
Phase 2 runs after a server restart and checks persistence and erasure cascades. Results on 9 Nov 2026: **SQLite 247/247 + phase 2 OK; PostgreSQL 16.2 247/247 + phase 2 OK; no 500s in server logs; `alembic check` clean on both.** The audit found and fixed one bug (comparing assessments of different beneficiaries returned 200 instead of 422). The pytest suite also passes on PostgreSQL (48 passed) via `TEST_DATABASE_URL`.

## Not covered / not run
Docker build/compose; automated accessibility checks (axe) and cross-browser runs; load/performance tests; penetration testing; mobile layout was
checked visually once at 375 px width (hamburger header) but not by automated tests.

## Frontend�backend integration audit (9 Nov 2026)
Scope: every user workflow driven through the real UI against the real API and database (no mocked endpoints except where a test deliberately injects a network failure, a 500/403 or latency to prove error/loading handling).

| Spec | Covers |
|---|---|
| `beneficiary.spec.ts` | Dashboard/history/trends/resources compared with the API's own numbers; follow-up request + duplicate error; consent persistence, data-export request, wrong-password error; full invitation ? registration ? empty states ? validation ? save/resume ? submit ? trends; deletion request ? admin erasure ? login refused |
| `staff.spec.ts` | Caseworker dashboard stats vs API, resolving notifications, case search/filter/sort/paging, case profile (note, follow-up, intervention, outcome, status) persisted after reload, follow-up and intervention pages, cross-caseworker access shows a clean error; admin user lifecycle + pagination, assignment, engine-config validation/reset, resources CRUD, audit-log filter, analytics filters re-query the API |
| `navigation-responsive.spec.ts` | Every sidebar and deep link per role, single active nav item, back/forward, route guards (logged out, wrong role, unknown route), server-side token revocation ? login; every page of every role at **375 / 768 / 1280 px** with no horizontal overflow, drawer navigation on small screens, modal fits a phone; slow API shows spinner; network failure ? error + working retry; 500 and 403 shown readably; failed save keeps the user's text; login lockout message |
| `workflows.spec.ts` | Original 4 smoke workflows |

Defects found and fixed during this audit:
1. **Phone layout overflow** (caseworker/admin pages scrolled sideways): visually hidden (`sr-only`, absolutely positioned) table headers inside scroll containers escaped clipping and widened the page. Fixed by making scroll containers positioned (`index.css`); cards also got `min-w-0`.
2. **Swallowed error**: the caseworker dashboard silently rendered nothing when its summary request failed (e.g. 403/500). It now shows the error with a retry.
3. **Hard-coded data in the UI**: default organisational unit "Demo Unit North" and the audit-log action list were literals. They now come from new endpoints `GET /admin/org-units` and `GET /admin/audit-actions`.
The remaining mock-like content search (`mock|fake|dummy|lorem|Math.random`, literal record arrays) found nothing else in `frontend/src`; only Vitest tests use a mocked network call, on purpose.

Test-infrastructure note: triggering a real file download in Edge (Playwright `channel: msedge`) leaves the browser unable to open new tabs for later tests, so the export test captures the generated blob link instead of saving a file.

## Demo-only login (added 11 Nov 2026)
The login page is demo-only by default (`VITE_LOGIN_MODE` unset): exactly three buttons (Beneficiary, Caseworker, Admin), a "Demo prototype" notice, no username/password/registration. `VITE_LOGIN_MODE=full` restores the normal sign-in form; the full-stack Playwright config starts its dev server in that mode. Checked by Vitest (both modes, progress/error/auto-retry while a sleeping server wakes up), by the static-build Playwright suite (6 tests) and by a run of the three roles against the real local backend.
