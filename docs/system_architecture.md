# System architecture

## 1. Context and goals
SAATHI is a decision-support prototype (SIH26094). Authorised people review explainable, rule-derived *review priorities*; the system never diagnoses
and never acts on a person automatically (no external messages, no punitive actions).

## 2. Component diagram
```mermaid
flowchart LR
  subgraph Client
    SPA[React SPA<br/>Vite · TS · Tailwind · Recharts]
  end
  subgraph Server[FastAPI application]
    R[Routers<br/>auth · beneficiaries · cases · assessments<br/>followups · interventions · analytics · admin · me]
    D[Deps: JWT auth + RBAC<br/>object-level access checks]
    S[Services: audit · cases · assessment_service · settings]
    E[Assessment engine<br/>questionnaire · rules · ML advisory]
  end
  DB[(SQLite / PostgreSQL)]
  ML[(models/ml_advisory.joblib<br/>optional)]
  SPA -- "/api JSON + Bearer JWT" --> R
  R --> D --> S --> DB
  S --> E
  E -. optional .-> ML
```

## 3. Layers and responsibilities
| Layer | Location | Responsibility |
|---|---|---|
| Presentation | `frontend/src` | Role-specific pages; **no business rules, no mock data** — everything via `/api` |
| API | `backend/app/routers` | HTTP contract, validation (Pydantic), status codes |
| Authorisation | `backend/app/deps.py` | `require_roles()` (role) and `authorize_beneficiary_access()` (object-level: own record / assigned caseworker) |
| Domain services | `backend/app/services` | Audit logging, read models, glue between DB and engine |
| Assessment engine | `backend/app/engine` | **Pure functions**, no DB/network. Replaceable without touching the rest |
| Persistence | `models.py`, `alembic/` | Normalised schema, constraints, migrations |

## 4. Data flow (check-in → notification)
```mermaid
sequenceDiagram
  participant B as Beneficiary (SPA)
  participant API as FastAPI
  participant ENG as Engine
  participant DB as Database
  participant C as Caseworker (SPA)
  B->>API: POST /assessments {consent_confirmed}
  API->>DB: INSERT draft assessment
  B->>API: PUT /assessments/{id}/responses (save & resume)
  B->>API: POST /assessments/{id}/submit
  API->>DB: load previous scored assessments
  API->>ENG: evaluate(answers, history, config)
  ENG-->>API: level, dimension scores, factors, change summary, data quality
  API->>DB: INSERT assessment_scores (+ ML advisory if model present)
  API->>DB: INSERT review_alert for assigned caseworker (attention/urgent)
  API->>DB: INSERT follow-up *request* if contact requested
  API-->>B: wellbeing score (+ verified support resources if critical item) — never the review level
  C->>API: GET /analytics/caseworker-summary, GET /alerts
  API-->>C: notifications, caseload metrics
  C->>API: GET /cases/{id} (audit-logged)
```

## 5. Assessment workflow
```mermaid
flowchart TD
  A[Consent confirmed] --> B[Draft created / resumed]
  B --> C[Answer section → autosave]
  C -->|more sections| C
  C --> D[Submit: required items validated server-side]
  D --> E[Engine scores answers + compares with history]
  E --> F{Level}
  F -->|Routine| G[Score stored, no alert]
  F -->|Attention| H[Alert: timely human review]
  F -->|Urgent review| I[Alert + beneficiary shown configured support resources]
  H --> J[Caseworker reviews → note / follow-up / intervention → mark reviewed]
  I --> J
```

## 6. Key design decisions
| Decision | Rationale |
|---|---|
| Rule-based engine is primary, ML is advisory only | Transparent, auditable, no unvalidated model controlling outcomes; app works with no model file |
| Engine is a pure module (`app/engine`) | Unit-testable; upgradeable (e.g. a clinically validated instrument) without rewriting the app |
| Beneficiaries never see review level | Avoids labelling; they see a well-being score (100 − concern index) and resources |
| Admins have **no** access to assessments/cases | Least privilege; admin analytics are aggregate-only |
| Non-assigned caseworker gets 404 (not 403) | Does not reveal that a case exists |
| JWT with `token_version` | Logout / password change / deactivation invalidate tokens server-side |
| Alerts are in-app only | Spec forbids messaging third parties; nothing leaves the system |
| `UTCDateTime` type | Consistent tz-aware UTC across SQLite and PostgreSQL |
| Python-side aggregation for case lists | Simple and correct for a prototype; see limitations |
