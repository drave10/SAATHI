# Future scope

## Clinical and methodological
* Replace or complement the prototype questionnaire with a **licensed, validated instrument** (after verifying terms of use and scoring), co-designed with clinicians and survivors' representatives; add translation and cultural adaptation.
* Prospective validation, threshold calibration (sensitivity/specificity trade-offs for the Attention/Urgent levels) and inter-rater studies with caseworkers.
* Fairness audit and subgroup error analysis once real, ethically approved data exists; keep demographic attributes out of model features.
* Safe, human-reviewed free-text support (e.g. highlighting for caseworker attention) — only with validated, consented, locally hosted models.

## Product
* Multilingual UI and voice/low-literacy modes; offline-first mobile app (PWA) for field workers.
* Caseworker scheduling calendar, reminders and, under explicit consent, SMS/WhatsApp reminders.
* Supervisor role, case hand-over workflows, referral tracking with partner organisations.
* Configurable questionnaire administration (item banks, schedules) instead of a fixed version.

## Engineering and security
* HttpOnly-cookie sessions with CSRF protection, MFA, password reset, refresh tokens, IP rate limiting, strict CSP.
* Field-level encryption, key management, tamper-evident audit logs, automated retention schedules (cron/worker).
* SQL-side aggregation and indexes for large caseloads; PostgreSQL deployment with managed backups; observability (structured logs, metrics).
* CI pipeline (tests, type-check, SBOM/dependency scanning), automated accessibility checks (axe), cross-browser e2e.
* Data-protection impact assessment and legally reviewed privacy notice (e.g. DPDP Act, 2023) before any real deployment.
