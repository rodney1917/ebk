# EBK Architecture

## Overview

```
 Customer app (React)        Admin portal (Phase 3)
        │  HTTPS                     │
        ▼                            ▼
   Nginx (TLS, rate limits, static SPA, /api proxy)
        │
        ▼
   NestJS API ── @ebk/core (pure domain logic, shared with web)
        │   ├── Auth (JWT access + rotating refresh cookie)
        │   ├── Reference data (countries, corridors, operators, fees, rates)
        │   ├── Quotes (estimate / locked)
        │   ├── Beneficiaries
        │   ├── Transfer engine ── Ledger (double entry)
        │   ├── Provider registry ── adapters: sandbox, MTN MoMo, Airtel (pending), UK PSP (pending)
        │   └── Webhooks (verify → store/de-dup → process)
        ▼
   PostgreSQL 16 (constraints + triggers enforce financial invariants)
```

## Principles

1. **Partners hold money; EBK records it.** EBK never custodies funds. The ledger mirrors positions held at
   collection and payout partners so they can be reconciled against partner statements.
2. **Domain logic is framework-free.** `@ebk/core` contains money maths, fees, quotes, the transfer state
   machine and journal construction. It is unit-tested without a database and shared with the web app,
   so the UI's estimate and the API's quote use identical arithmetic.
3. **Defence in depth for invariants.** Rules are enforced in code and again in Postgres: transfer
   transitions, immutable financial terms, append-only audit/ledger/history/rate tables, balanced journals
   (deferred constraint trigger), one successful payment/payout per transfer (partial unique indexes),
   webhook de-duplication, four-eyes refunds.
4. **Configuration, not code, per country.** Countries, dial codes, operator prefixes, corridors, limits,
   fee rules and providers are database rows (seeded from `packages/core/src/corridors.ts`). Adding a
   corridor is data plus, if needed, a new provider adapter.
5. **Honest data.** No fictional balances. Every rate carries a kind — `LIVE`, `ESTIMATED` or `SANDBOX` —
   and the UI labels it. An expired live rate is downgraded to `ESTIMATED` and cannot be locked. Sandbox
   rates cannot be locked in production and are filtered out of production queries.

## Money

- BigInt minor units in code; `NUMERIC(20,4)` amounts and `NUMERIC(20,8)` rates in Postgres; decimal
  strings in JSON. `BigInt.prototype.toJSON` throws to catch accidental serialisation.
- Quote model: customer enters the amount to send; fee is added on top
  (`total = send + fee`); `recipient = floor(send × rate)`.
- Rounding: percentage fees round half-up; recipient amounts round down (EBK never promises more than it
  can pay).

## Transfer lifecycle

```
DRAFT ─► PENDING_PAYMENT ─► PAYMENT_PROCESSING ─► PAYMENT_RECEIVED ─► PAYOUT_PROCESSING ─► COMPLETED
  │            │   └──────────────► PAYMENT_RECEIVED      │    ▲                │
  ▼            ▼                                          ▼    │                ▼
CANCELLED   FAILED / CANCELLED                  COMPLIANCE_REVIEW ─┘      REFUND_PENDING ─► REFUNDED
```

Once funds are collected a transfer can never become `FAILED` or `CANCELLED` — only `COMPLETED` or
refunded. Payout failures are retried (up to 3 attempts, skipping non-retryable codes) before moving
to `REFUND_PENDING` with a compliance case.

### Engine rules (`apps/api/src/transfers/transfer-engine.service.ts`)

- `transition()` locks the row (`SELECT … FOR UPDATE`), validates via `@ebk/core`, bumps `version`
  (optimistic check + DB trigger), writes `transfer_status_history` and `audit_logs` in one
  serializable transaction (retried on serialization failure).
- Provider calls happen **outside** DB transactions. An attempt row with a stable idempotency key
  (`<ref>:collect:1`, `<ref>:payout:<n>`) is committed first and sent to the provider, so a crash
  mid-call is resolved by asking the provider about that key.
- `UNKNOWN` provider outcomes (timeouts, 5xx) are never treated as success or failure; a scheduler
  polls them (`PayoutPoller`, every 30 s).
- Ledger journals: `PAYMENT_RECEIVED`, `PAYOUT_COMPLETED`, `REFUND_COMPLETED`, `REVERSAL`, each with an
  idempotency key so retries can't double-post.

### Idempotency

`POST /transfers` and `POST /transfers/:id/confirm` require an `Idempotency-Key`. The first response is
stored (`idempotency_keys`); retries with the same body replay it; a different body with the same key
returns 422. `transfers(user_id, idempotency_key)` is also unique.

## Provider abstraction

`apps/api/src/providers/provider.types.ts` defines `CollectionAdapter` (initiate, status, refund,
webhook verify/parse) and `PayoutAdapter` (initiate, status, optional reversal). The registry builds
adapters from `payment_providers` / `payout_providers` rows and refuses sandbox adapters/rows in
production. Card data is only ever entered on a partner's hosted page.

| Adapter | Status |
|---|---|
| `sandbox-collection` | Working. Hosted "checkout" page + HMAC-signed webhooks through the real pipeline. |
| `sandbox-payout` | Working. Deterministic outcomes by recipient number. |
| `mtn-momo-disbursement` | Written to MTN Open API shape; unit-tested with mocked HTTP; **not yet run against MTN sandbox**. |
| `airtel-money-disbursement` | Stub — reports not configured until Airtel onboarding. |
| UK collection (cards/open banking) | Not started — partner to be selected. |

## Frontend

React 19, React Router, TanStack Query, React Hook Form + Zod, Tailwind v4. Design tokens live in
`apps/web/src/styles/index.css` (`@theme`); components in `apps/web/src/design-system`. Access tokens are
kept in memory only; the refresh token is an httpOnly, `SameSite=Strict` cookie scoped to `/api/auth`.
Mutations are never auto-retried.

## Known scaling notes

- The payout poller is single-instance safe; for multiple API replicas wrap it in a Postgres advisory
  lock or move it to a queue (BullMQ/pg-boss).
- Outbound provider calls inside request handlers (`confirm`, post-payment payout start) should move to a
  job queue before pilot.
