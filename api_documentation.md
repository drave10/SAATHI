# API documentation

Interactive docs (generated from the code): **Swagger UI** `http://localhost:8000/docs`, **ReDoc** `/redoc`, schema `/openapi.json`.
All paths below are prefixed with `/api`. Authenticate with `Authorization: Bearer <JWT>` from `POST /auth/login`.

Errors: `401` unauthenticated/invalid/revoked token · `403` role not allowed · `404` not found **or** not your case · `409` state conflict ·
`422` validation (`{"detail":"Validation failed","errors":[{field,message}]}`) · `429` account temporarily locked · `500` generic message (details only in server log).

| Role legend | B = beneficiary · C = caseworker · A = admin |
|---|---|

## Auth
| Method & path | Roles | Description |
|---|---|---|
| POST `/auth/register` | public (needs invitation code) | Onboarding: validates one-time code, requires consent, creates user + beneficiary + consent records |
| POST `/auth/login` | public | Returns JWT + user. Lockout after 5 failed attempts (15 min) |
| POST `/auth/logout` | any | Bumps `token_version` → all tokens for the user become invalid |
| GET `/auth/me` | any | Current user |
| POST `/auth/change-password` | any | Verifies current password; invalidates existing tokens |

## Beneficiaries
| Method & path | Roles | Description |
|---|---|---|
| POST `/beneficiaries` | C, A | Create beneficiary (C: auto-assigned to self) |
| GET `/beneficiaries` | C, A | Basic roster (no assessment data); C sees assigned only |
| GET `/beneficiaries/me` | B | Dashboard data: well-being score, due status, follow-ups |
| GET `/beneficiaries/{id}` | B(own), C(assigned), A(profile only) | Profile |
| PATCH `/beneficiaries/{id}` | B(limited), C, A | Update permitted fields (beneficiary: language/display name only) |

## Assessments
| Method & path | Roles | Description |
|---|---|---|
| GET `/assessments/questionnaire` | any | Questionnaire (scoring map is **not** sent) |
| POST `/assessments` | B | Create draft (requires `consent_confirmed`); resumes open draft |
| GET `/assessments/draft` | B | Current draft with answers |
| PUT `/assessments/{id}/responses` | B | Save partial answers (validated per question) |
| POST `/assessments/{id}/submit` | B | Validates required items, runs engine, stores score, creates alert/follow-up request; returns well-being score and, if critical items were triggered, verified support resources |
| GET `/assessments?beneficiary_id=` | B(own), C(assigned) | History. **B never receives review level or concern index** |
| GET `/assessments/{id}` | B(own), C(assigned) | Detail incl. responses (C views are audit-logged) |
| GET `/assessments/{id}/explanation` | C | Factors, change summary, data quality, ML advisory, disclaimer |
| GET `/assessments/{id}/compare?with_id=` | C | Deltas vs previous (or chosen) assessment |
| POST `/assessments/{id}/recalculate` | C | Re-run engine with current configuration |
| POST `/assessments/{id}/mark-reviewed` | C | Record human review |

## Cases, notifications
| Method & path | Roles | Description |
|---|---|---|
| GET `/cases` | C (clinical view), A (roster only) | Search `q`, filters `status`, `priority`, `needs_review`, `assessment_due`, `org_unit`; `sort` (priority\|name\|last_assessment\|status), `order`, `page`, `page_size` |
| GET `/cases/{id}` | C (assigned) | Whole profile in one response (timeline, explanation, alerts, follow-ups, interventions, notes) |
| PATCH `/cases/{id}/status` | C | open / monitoring / follow_up_needed / closed |
| POST `/cases/{id}/notes` | C | Add note |
| POST `/cases/{id}/assign` | A | (Re)assign caseworker; open alerts/follow-ups follow the case |
| GET `/alerts?status=` | C | Review notifications (urgent first) |
| PATCH `/alerts/{id}` | C | acknowledged / resolved |

## Follow-ups and interventions
| Method & path | Roles | Description |
|---|---|---|
| POST `/followups` | B (request), C (schedule) | B: creates a *request* (one open at a time); C: needs `beneficiary_id` and `scheduled_for` |
| GET `/followups` | B(own), C(assigned) | Filters `status`, `due_within_days`, `overdue`, `beneficiary_id`, paging |
| PATCH `/followups/{id}` | B (cancel own request), C | Reschedule / update status |
| POST `/followups/{id}/complete` | C | Mark completed with notes |
| GET `/interventions/types` · GET `/interventions` | C | Types; history for assigned cases (`beneficiary_id`, `outcome`) |
| POST `/interventions` | C | Record intervention |
| PATCH `/interventions/{id}/outcome` | C | Record outcome |

## Analytics
| Method & path | Roles | Description |
|---|---|---|
| GET `/analytics/caseworker-summary` | C | Assigned, completed, pending, awaiting review, urgent notifications, due/overdue follow-ups, recent activity |
| GET `/analytics/overview?from_date&to_date&org_unit` | A | Aggregate statistics; no identifiers; counts below `ANALYTICS_MIN_CELL` returned as `null`; wellbeing/priority views only include people who consented to analytics |
| GET `/analytics/trends` | A | Subset for charts |

## Admin
| Method & path | Roles | Description |
|---|---|---|
| GET/POST `/admin/users`, PATCH `/admin/users/{id}` | A | List/create staff, change role, (de)activate, reset password (cannot demote/deactivate self) |
| GET `/admin/caseworkers` | A, C | Caseworkers with caseload |
| GET `/admin/org-units` | A, C | Distinct organisational units in use (feeds UI dropdowns) |
| GET `/admin/audit-actions` | A | Distinct audit action names (feeds the audit-log filter) |
| POST `/admin/invitations` | A, C | One-time onboarding code (returned once; stored hashed) |
| GET/POST `/admin/resources`, PUT/DELETE `/admin/resources/{id}` | A | Education / support / **emergency contact** management |
| GET/PUT `/admin/engine-config` | GET: A, C · PUT: A | Engine thresholds (validated); also reports ML model status/metrics |
| GET `/admin/audit-logs` | A | Paged, filter by `action`, `actor_user_id` |
| GET `/admin/deletion-requests`, DELETE `/admin/beneficiaries/{id}` | A | Erasure workflow |
| POST `/admin/retention/run` | A | Purge old free text |

## Self-service and system
| Method & path | Roles | Description |
|---|---|---|
| GET `/resources?category=` | any | Active resources |
| GET/POST `/me/consents` | B | Consent state/history; append a change |
| POST `/me/deletion-request` · GET `/me/export` | B | Request erasure; download own data (JSON) |
| GET `/health` | public | DB connectivity + ML model availability |
