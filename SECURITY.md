# EBK Security

EBK is treated as a financial application. This document states what is **implemented** and what is
**required before a pilot**. Nothing here is a claim of certification (PCI DSS, ISO 27001, etc.).

## Implemented

| Control | Where |
|---|---|
| Password hashing: scrypt N=2¹⁵ r=8 p=1, per-user salt, parameter versioning + rehash on login | `common/crypto.ts` |
| Password policy: ≥12 chars, no email local-part, no trivial repeats | `common/crypto.ts` |
| Login throttling (5–10/min), lockout 15 min after 5 failures, timing-equalised unknown-user path | `auth/` |
| JWT access tokens (15 min, `aud`/`iss`/`typ` checked); token held in memory in the browser | `auth/`, `web/lib/api.ts` |
| Refresh tokens: random 384-bit, stored as SHA-256, httpOnly + Secure + SameSite=Strict cookie scoped to `/api/auth`, single-use rotation with **reuse detection** (revokes family) | `auth/auth.service.ts` |
| CSRF: SameSite=Strict + required `X-EBK-Client` header on cookie endpoints + strict CORS allow-list | `auth/auth.controller.ts`, `main.ts` |
| Global auth guard (deny by default; `@Public()` opt-out) | `common/http.ts` |
| Rate limiting: app (`@nestjs/throttler`) and edge (Nginx `limit_req`) | `app.module.ts`, `infra/nginx` |
| Input validation with Zod on every body/query; unknown keys stripped; body size limits | `common/http.ts`, `main.ts` |
| SQL injection: Prisma parameterised queries; the only raw SQL uses tagged templates | engine |
| Security headers: Helmet (HSTS in prod, CSP, no-referrer, frame-ancestors none) + Nginx CSP | `main.ts`, `infra/nginx` |
| Field encryption: AES-256-GCM with AAD for bank account / document numbers / MFA secrets | `common/crypto.ts` |
| Webhooks: HMAC verification, timestamp tolerance (replay), event de-duplication, rejected events logged | `webhooks/`, `providers/sandbox/sandbox-signing.ts` |
| Idempotency keys on money-moving endpoints | `common/idempotency.service.ts` |
| Immutable audit log (DB triggers block UPDATE/DELETE/TRUNCATE); sensitive fields redacted | `common/audit.service.ts`, migration |
| Secrets only from environment; config validated at boot; sandbox providers refused in production | `config/env.ts` |
| No card data: payment details only on the partner's hosted page | engine, sandbox |
| No PAN/CVV columns anywhere in the schema | migration |
| Minimal PII: no national ID numbers collected at registration | `auth.service.ts` |
| Containers run as non-root; DB bound to loopback | Dockerfiles, compose |

## Required before pilot (not yet done)

- **MFA**: TOTP/WebAuthn for customers (optional) and **mandatory for all admin users**.
- Email and phone verification flows; password reset with single-use, short-lived tokens.
- Admin portal RBAC enforcement (roles/permissions are seeded; guards not yet written).
- KYC provider integration; sanctions/PEP screening provider at the `PAYMENT_RECEIVED` screening hook.
- Secret manager (or SOPS-encrypted env) and key rotation for `FIELD_ENCRYPTION_KEY` / JWT secret.
- Separate DB roles (app role without DDL/TRUNCATE); encrypted, off-site backups with restore drills.
- Centralised logging/alerting (failed logins, refresh-token reuse, rejected webhooks, stuck payouts).
- Dependency scanning (npm audit / Dependabot), SAST, and an **independent penetration test**.
- Data-protection work: UK GDPR & Zambia Data Protection Act 2021 — DPIA, retention schedule, privacy notice.
- Payment partner due diligence; PCI DSS scope confirmed as SAQ-A-style (hosted fields only) by a QSA.

## Reporting

Report suspected vulnerabilities privately to the EBK technical owner. Do not open public issues.
