# Security and privacy

SAATHI is designed around sensitive data, but it is a **prototype**: it has had no external security review, penetration test or legal/data-protection assessment.

## Threat-oriented controls (implemented)
| Concern | Control | Where |
|---|---|---|
| Passwords | bcrypt (12 rounds; 72-byte limit enforced), strength check; never logged or returned | `security.py` |
| Authentication | JWT (HS256), 60-min expiry, `token_version` revocation on logout / password change / deactivation / role change | `security.py`, `deps.py` |
| Brute force | 5 failed logins → 15-min lock; dummy-hash verification equalises timing for unknown usernames | `routers/auth.py` |
| Authorisation | `require_roles()` on every route + object-level `authorize_beneficiary_access()`; non-assigned caseworker gets 404; admins cannot read assessments or case content (403) | `deps.py` |
| Injection | SQLAlchemy parameterised queries; Pydantic validation (types, lengths, patterns, enums) on all inputs | everywhere |
| XSS | React escapes output; no `dangerouslySetInnerHTML`; API responses `X-Content-Type-Options: nosniff` | frontend, `main.py` |
| Clickjacking / caching | `X-Frame-Options: DENY`, `Cache-Control: no-store`, `Referrer-Policy: no-referrer` | `main.py`, `nginx.conf` |
| CORS | Explicit origin list, no credentials | `main.py` |
| Secrets | From environment / `.env` (git-ignored); app refuses to start in production with a weak `SECRET_KEY`; seed passwords come from env, none hard-coded | `config.py` |
| Error leakage | Generic 500 body; stack traces only in server log; request bodies are never logged | `main.py` |
| Public URLs | No static/public endpoint exposes responses; every data route requires a bearer token | — |
| Onboarding | Registration requires a single-use, expiring invitation code (stored only as SHA-256 hash) | `routers/auth.py`, `admin.py` |

## Privacy by design
* **Minimal data:** pseudonymous case code, nickname-capable display name, coarse age band. No addresses, phone numbers or government IDs.
* **Separation:** analytics endpoints never return identifiers; they aggregate from tables without joining `users`; counts under `ANALYTICS_MIN_CELL` (default 3) are suppressed;
  wellbeing/priority aggregates include only people whose latest `analytics_use` consent is granted.
* **Consent:** explicit consent is required to register and again to start each assessment; append-only `consent_records`; beneficiaries can change optional consents.
* **Audit:** logins (incl. failures), case/assessment views by staff, status changes, assignments, config changes, erasures. Details never contain answers or secrets.
* **Rights:** data export (`GET /me/export`), deletion request → admin erasure (cascade), retention job for free text.
* **Beneficiary-facing framing:** beneficiaries are never shown a risk label; they see a well-being score and resources.
* **Crisis information:** if critical items are answered, configured support resources are displayed with a clear statement that the app is not an emergency service. Resource entries show *Verified/Pending verification* — administrators must verify contacts before real use.
* **Synthetic data only:** no real beneficiary data exists anywhere in the repository.

## Demo mode
`DEMO_MODE=true` enables `POST /auth/demo-login`, a **passwordless** sign-in restricted to the seeded synthetic accounts (`is_synthetic = true`). It is off by default and must never be enabled where real data exists. In demo mode the shared accounts cannot be deactivated, re-roled, password-changed or erased, and logout does not revoke other sessions; all demo logins are audit-logged (`demo_login`). Anyone who can reach the site can act as an administrator of the synthetic data.

## Known gaps / residual risks
* JWT in `sessionStorage` is readable by injected scripts (XSS). Mitigations here are React escaping and no third-party scripts; a production system should prefer HttpOnly cookies + CSRF protection and a strict CSP.
* No MFA, no password-reset by e-mail, no token refresh, no IP rate limiting (only per-account lockout; the lockout can itself be used to lock a known user out).
* Data at rest is not encrypted at the application level (rely on disk/DB encryption); no key rotation.
* HTTPS termination is expected from a reverse proxy; the provided nginx config is HTTP only.
* Audit logs are not tamper-evident. Free-text could contain identifying information typed by users.
* The privacy notice text is a prototype and must be replaced with a legally reviewed notice (e.g. under India's DPDP Act, 2023).
