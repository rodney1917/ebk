# EBK Database

PostgreSQL 16. Schema: `apps/api/prisma/schema.prisma` (Prisma client) and
`apps/api/prisma/migrations/0001_init/migration.sql` (authoritative DDL).

## Conventions

- `snake_case` tables/columns, UUID primary keys (`gen_random_uuid()`), `audit_logs` uses `BIGSERIAL`.
- `TIMESTAMPTZ(3)` for every timestamp; servers and containers run in UTC.
- Money `NUMERIC(20,4)`, rates `NUMERIC(20,8)`. **No floating-point columns.**
- Soft deletion (`deleted_at`) for users, addresses, beneficiaries. Financial records are never deleted.
- Encrypted-at-application-level fields end in `_enc` (AES-256-GCM, `FIELD_ENCRYPTION_KEY`).

## Tables (40)

| Area | Tables |
|---|---|
| Reference | `currencies`, `countries`, `mobile_operators`, `corridors` |
| Customers & auth | `users`, `user_sessions`, `customer_profiles`, `addresses` |
| KYC | `kyc_cases`, `identity_documents` |
| Recipients | `beneficiaries` |
| Pricing | `exchange_rates` (append-only), `fee_rules`, `quotes` |
| Transfers | `transfers`, `transfer_status_history` (append-only), `payment_attempts`, `payout_attempts`, `refunds` |
| Providers | `payment_providers`, `payout_providers`, `provider_webhooks` |
| Ledger | `financial_accounts`, `ledger_transactions`, `ledger_entries` (both append-only) |
| Reconciliation | `reconciliation_batches`, `reconciliation_items` |
| Operations | `notifications`, `support_tickets`, `support_notes`, `compliance_cases`, `risk_flags` |
| Admin | `admin_users`, `roles`, `permissions`, `role_permissions`, `admin_user_roles` |
| Platform | `audit_logs` (append-only), `system_settings`, `idempotency_keys` |

`user_sessions`, `support_notes`, `mobile_operators`, `corridors`, `quotes`, `role_permissions`,
`admin_user_roles` and `idempotency_keys` were added beyond the brief's initial list because the
features need them.

## Integrity enforced in the database

| Rule | Mechanism |
|---|---|
| Unique email (case-insensitive) | unique index on `lower(email)` |
| Valid transfer transitions only; `version` must +1 | `transfers_transition` trigger |
| Amounts, rate, currencies, reference, beneficiary snapshot immutable | `transfers_terms_immutable` trigger |
| Transfers never deleted | `transfers_no_delete` trigger |
| `total_payable = send_amount + fee` | CHECK on `quotes`, `transfers` |
| One quote → one transfer | unique `transfers.quote_id` |
| One successful / one in-flight payment and payout per transfer | partial unique indexes |
| Webhook processed once | unique `(provider_code, event_id)` |
| Journals balance per currency, ≥ 2 lines | deferred constraint trigger `ledger_entries_balanced` |
| Entry currency = account currency | `ledger_entries_currency` trigger |
| Ledger/audit/history/rates append-only (incl. TRUNCATE for audit & entries) | `ebk_forbid_mutation()` triggers |
| Refund approver ≠ requester | CHECK `refunds_four_eyes_chk` |
| Mobile-money beneficiary has operator + digits-only MSISDN | CHECK |

These are verified by `apps/api/test/db/schema.test.sql`: 28 rejected-mutation checks, a balanced
ledger posting and a zero trial balance.

## Working with Prisma

Prisma cannot express partial indexes, CHECKs or triggers, and a few foreign keys in the SQL (e.g.
`kyc_cases.reviewed_by_id → admin_users`) have no Prisma relation yet. When changing the schema:

```bash
npx prisma migrate dev --create-only --name <change>
```

then **review the generated SQL** and delete any statement that drops the hand-written objects above.
Before the first real migration, run `npx prisma migrate diff --from-migrations prisma/migrations
--to-schema-datamodel prisma/schema.prisma --shadow-database-url …` and add Prisma relations for any
remaining differences.

## Database roles (pre-pilot)

Run the API as a role without `TRUNCATE`, `DROP` or ownership of tables; run migrations as a separate
owner role. Triggers are a safeguard against application bugs, not against a DB superuser.
