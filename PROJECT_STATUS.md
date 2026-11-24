# EBK — Project Status

_Last updated: 24 Nov 2026 · Milestone: Phase 1 foundation + Phase 2 customer app (first pass) + Phase 4 engine core_

## Build environment note

The initial build ran in a workspace with **no package-registry access**. React, Tailwind v4, Zod,
esbuild, TypeScript and PostgreSQL 16 were available; NestJS, Prisma, Vite, React Router, TanStack Query
and React Hook Form were not. Consequences:

- Domain logic, framework-free API modules, the database schema and the UI preview were **run and tested**.
- NestJS controllers/services, Prisma client usage and the Vite build are **written but not compiled or
  run**. The first job on a machine with `npm install` is the "Verify" list below.

Legend: ✅ implemented and tested · 🟡 implemented, not yet executed · ⏳ in progress / partial · ⛔ blocked · ⬜ remaining

## Completed (tested)

| Item | Evidence |
|---|---|
| ✅ `@ebk/core` money (BigInt minor units), FX conversion, fee rules, quotes, limits, rate kinds | 29 unit tests pass; `tsc --strict` clean |
| ✅ Transfer state machine (11 statuses), funds-collected invariants | unit tests incl. reachability |
| ✅ Double-entry journals (payment, payout, refund, reversal), per-currency balance | unit tests |
| ✅ Transfer references with check character; Zambian MSISDN normalisation & operator-prefix validation | unit tests |
| ✅ PostgreSQL schema — 40 tables, 21 enums, indexes, FKs, CHECKs, partial uniques, 5 trigger functions | applied to Postgres 16.15; 28 rejected-mutation checks, a balanced ledger posting and a zero trial balance all pass |
| ✅ Password hashing, field encryption, idempotency hashing, webhook signing/replay protection | 20 API unit tests pass |
| ✅ Sandbox collection & payout adapters (refuse production) | unit tests |
| ✅ MTN MoMo disbursement adapter — headers, amount format, token caching, 202/409/4xx/5xx mapping | unit tests with mocked HTTP |
| ✅ Boot-time config validation (sandbox forbidden in prod, prod can't target MTN sandbox, weak secrets rejected) | unit tests |
| ✅ Customer UI: design system, app shell, Home dashboard, Send (amount → recipient → review/lock → pay), Recipients (add/edit/delete + validation), Transactions (filters), Transfer detail (live timeline), Receipt (print/share), Login/Register, Airtime placeholder, Help | Demo preview built and clicked through in Chromium at 1440px and 390px; no console errors; no horizontal overflow on mobile |

## Implemented, not yet executed (🟡)

- NestJS API: auth (register/login/refresh rotation with reuse detection/logout/me), reference data,
  quotes, beneficiaries, transfer engine, ledger posting, provider registry, webhooks, sandbox checkout,
  payout poller, health, Swagger.
- Prisma schema mirroring the SQL; seed script (reference data, RBAC roles/permissions, sandbox data in dev only).
- Jest + Supertest e2e spec for the full sandbox transfer flow (`apps/api/test/e2e`).
- Dockerfiles, docker-compose (db, migrate, api, web, backup), Nginx config, backup script.
- Vite build config for the web app.

### Verify first (on a machine with npm access)

1. `npm install` → commit `package-lock.json`.
2. `npm run typecheck` and fix any compile errors in `apps/api` / `apps/web`.
3. `npx -w @ebk/api prisma validate` and `prisma migrate diff` against the SQL migration (see DATABASE.md).
4. `npm run db:migrate && npm run db:seed`, then `npm run test:e2e -w @ebk/api`.
5. `npm run build -w @ebk/web` and run through the flow against the real API.

## In progress / partial (⏳)

- Customer profile: data model complete; profile view/edit screens not built.
- Notifications: table + "transfer completed" record written by the engine; no list endpoint/UI yet
  (dashboard "Updates" is derived from live transfer data).
- Compliance screening: threshold rule → `COMPLIANCE_REVIEW` + risk flag; real sanctions/PEP screening not integrated.
- Refunds: engine `completeRefund` + journal; admin request/approve flow and provider refund call not built.

## Blocked (⛔) — external dependencies

| Item | Needs |
|---|---|
| UK payment collection (cards / open banking) | Choice of authorised UK PSP + sandbox credentials |
| MTN MoMo sandbox run | MTN developer subscription key + API user/key (free sandbox sign-up) |
| MTN MoMo Zambia production | MTN Zambia commercial onboarding |
| Airtel Money adapter | Airtel Zambia merchant onboarding, PIN encryption key |
| KYC provider | Provider selection (e.g. for UK document + liveness checks) |
| Live FX rate source | Contracted rate provider / partner rate feed |
| Fee schedule | Management pricing decision (current values are placeholders) |
| Final logo | Approved EBK logo files (placeholder mark in use) |
| Airtime & data | Approved commercial airtime API |

## Remaining (⬜)

- Email/phone verification, password reset, MFA (customer optional, admin mandatory).
- KYC workflow screens + document upload (encrypted object storage).
- **Phase 3 Admin portal**: dashboard, customers, transfers, KYC queue, RBAC guards, support notes.
- Reconciliation import & matching; provider health dashboard; webhook log viewer.
- Rate ingestion job; corridor/fee admin.
- Playwright e2e for the web app; load tests; security review & pen test.
- Job queue for provider calls; advisory lock for multi-instance poller.
- Phase 7 pilot — only with regulatory permissions, partner approvals and owner authorisation.

## Next milestone

**Phase 1/2 completion + Phase 3 start:** verify/compile the API and web app with real dependencies,
run the e2e suite, connect MTN MoMo sandbox, then begin the admin portal (KYC queue and transfer management first).
