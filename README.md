# EBK — Empower Bank Konnect

**Empower. Bank. Connect.** · *Your Money. Your World.*

EBK is an African-focused fintech platform. Its first product, **EBK Send**, lets customers in the
United Kingdom send money to MTN MoMo and Airtel Money wallets in Zambia. EBK uses authorised partners
to collect payments, safeguard funds where required, settle and pay out.

> EBK is **not** a bank, does not hold customer funds, and makes no claim of PCI DSS compliance.
> Nothing in this repository moves real money. Production use requires regulatory permissions,
> partner contracts and explicit owner authorisation (Phase 7).

## Repository

```
packages/core     Framework-free domain logic: money, quotes, fees, transfer state machine,
                  double-entry ledger, references, beneficiary validation, corridor seed config
apps/api          NestJS + Prisma + PostgreSQL backend (auth, quotes, beneficiaries, transfer engine,
                  provider abstraction, webhooks, sandbox adapters, MTN MoMo adapter)
apps/web          React + Vite + TypeScript + Tailwind v4 customer app (design system, dashboard,
                  send flow, recipients, transactions, receipts)
infra/            Nginx config, backup script
tools/preview     Offline single-file DEMO build of the customer app (no backend)
```

## Quick start (development)

Requirements: Node.js ≥ 22.12, Docker, npm.

```bash
cp .env.example .env                 # then set secrets (see comments in the file)
docker compose up -d db              # PostgreSQL 16 on 127.0.0.1:5432
npm install
npm run build -w @ebk/core
npx -w @ebk/api prisma generate
npm run db:migrate && npm run db:seed
npm run dev:api                      # http://localhost:3000/api  (Swagger: /api/docs)
npm run dev:web                      # http://localhost:5173
```

The development seed creates clearly-labelled **SANDBOX** providers, a **SANDBOX** GBP→ZMW rate, and a
demo account `demo.sender@ebk.test` / `Sandbox-Demo-Only-2026`. None of these are created when
`NODE_ENV=production`, and the API refuses to start with sandbox providers enabled in production.

Sandbox payout outcomes are chosen by recipient number: ending `0000` fails, ending `9999` stays pending,
anything else succeeds after a few seconds.

## Tests

```bash
npm run test:core                    # domain logic (node:test)
npm test -w @ebk/api                 # security, signing, adapters, config safety (node:test)
npm run test:db -w @ebk/api          # applies migrations to a scratch DB and runs SQL integrity tests
npm run test:e2e -w @ebk/api         # full API flow against a seeded DB (Jest + Supertest)
```

## Demo preview (no backend)

```bash
npm run preview:web                  # writes apps/web/dist-preview/index.html
```

## Documentation

[ARCHITECTURE](ARCHITECTURE.md) · [DATABASE](DATABASE.md) · [API](API_DOCUMENTATION.md) ·
[SECURITY](SECURITY.md) · [DEPLOYMENT](DEPLOYMENT.md) · [PROJECT STATUS](PROJECT_STATUS.md)
