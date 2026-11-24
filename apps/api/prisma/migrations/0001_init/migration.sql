-- EBK initial schema (PostgreSQL 15+)
-- Conventions: snake_case, UUID PKs, timestamptz(3) in UTC, NUMERIC for money (never float),
-- append-only financial/audit tables protected by triggers. See DATABASE.md.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
CREATE TYPE "user_status" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');
CREATE TYPE "kyc_status" AS ENUM ('NOT_STARTED', 'PENDING', 'IN_REVIEW', 'VERIFIED', 'REJECTED', 'RESUBMISSION_REQUIRED');
CREATE TYPE "transfer_status" AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'PAYMENT_PROCESSING', 'PAYMENT_RECEIVED', 'COMPLIANCE_REVIEW', 'PAYOUT_PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REFUND_PENDING', 'REFUNDED');
CREATE TYPE "rate_kind" AS ENUM ('LIVE', 'ESTIMATED', 'SANDBOX');
CREATE TYPE "payout_method_type" AS ENUM ('MOBILE_MONEY', 'BANK_ACCOUNT');
CREATE TYPE "provider_environment" AS ENUM ('SANDBOX', 'PRODUCTION');
CREATE TYPE "attempt_status" AS ENUM ('CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'UNKNOWN');
CREATE TYPE "ledger_side" AS ENUM ('DEBIT', 'CREDIT');
CREATE TYPE "account_type" AS ENUM ('ASSET', 'LIABILITY', 'REVENUE', 'EXPENSE', 'EQUITY');
CREATE TYPE "webhook_status" AS ENUM ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED', 'REJECTED');
CREATE TYPE "refund_status" AS ENUM ('REQUESTED', 'APPROVED', 'PROCESSING', 'COMPLETED', 'FAILED', 'REJECTED');
CREATE TYPE "recon_source" AS ENUM ('COLLECTION', 'PAYOUT', 'SETTLEMENT');
CREATE TYPE "recon_batch_status" AS ENUM ('UPLOADED', 'PROCESSING', 'COMPLETED', 'FAILED');
CREATE TYPE "recon_result" AS ENUM ('MATCHED', 'MISSING_IN_EBK', 'MISSING_AT_PROVIDER', 'AMOUNT_MISMATCH', 'STATUS_MISMATCH', 'DUPLICATE');
CREATE TYPE "case_status" AS ENUM ('OPEN', 'IN_PROGRESS', 'ESCALATED', 'CLOSED');
CREATE TYPE "risk_severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');
CREATE TYPE "risk_flag_status" AS ENUM ('OPEN', 'CLEARED', 'CONFIRMED');
CREATE TYPE "ticket_status" AS ENUM ('OPEN', 'PENDING_CUSTOMER', 'RESOLVED', 'CLOSED');
CREATE TYPE "notification_channel" AS ENUM ('IN_APP', 'EMAIL', 'SMS', 'PUSH');
CREATE TYPE "actor_type" AS ENUM ('CUSTOMER', 'ADMIN', 'SYSTEM', 'PROVIDER');
CREATE TYPE "document_status" AS ENUM ('SUBMITTED', 'VERIFIED', 'REJECTED', 'EXPIRED');

-- ---------------------------------------------------------------------------
-- Reference data
-- ---------------------------------------------------------------------------
CREATE TABLE "currencies" (
  "code"        CHAR(3) PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "minor_units" SMALLINT NOT NULL CHECK ("minor_units" BETWEEN 0 AND 4),
  "symbol"      TEXT NOT NULL,
  "active"      BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE "countries" (
  "code"                   CHAR(2) PRIMARY KEY,
  "name"                   TEXT NOT NULL,
  "currency_code"          CHAR(3) NOT NULL REFERENCES "currencies"("code"),
  "dial_code"              TEXT NOT NULL,
  "national_number_length" SMALLINT NOT NULL,
  "trunk_prefix"           TEXT,
  "can_send"               BOOLEAN NOT NULL DEFAULT FALSE,
  "can_receive"            BOOLEAN NOT NULL DEFAULT FALSE,
  "payout_methods"         "payout_method_type"[] NOT NULL DEFAULT '{}',
  "kyc_requirements"       JSONB NOT NULL DEFAULT '{}',
  "regulatory_rules"       JSONB NOT NULL DEFAULT '{}',
  "active"                 BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE "mobile_operators" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "country_code" CHAR(2) NOT NULL REFERENCES "countries"("code"),
  "code"         TEXT NOT NULL UNIQUE,
  "name"         TEXT NOT NULL,
  "prefixes"     TEXT[] NOT NULL DEFAULT '{}',
  "active"       BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE "corridors" (
  "id"                   TEXT PRIMARY KEY,
  "source_country"       CHAR(2) NOT NULL REFERENCES "countries"("code"),
  "source_currency"      CHAR(3) NOT NULL REFERENCES "currencies"("code"),
  "destination_country"  CHAR(2) NOT NULL REFERENCES "countries"("code"),
  "destination_currency" CHAR(3) NOT NULL REFERENCES "currencies"("code"),
  "min_send_amount"      NUMERIC(20,4) NOT NULL CHECK ("min_send_amount" > 0),
  "max_send_amount"      NUMERIC(20,4) NOT NULL,
  "quote_lock_seconds"   INTEGER NOT NULL DEFAULT 600 CHECK ("quote_lock_seconds" BETWEEN 30 AND 3600),
  "active"               BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT "corridors_limits_chk" CHECK ("max_send_amount" >= "min_send_amount"),
  CONSTRAINT "corridors_pair_key" UNIQUE ("source_country", "source_currency", "destination_country", "destination_currency")
);

-- ---------------------------------------------------------------------------
-- Customers & auth
-- ---------------------------------------------------------------------------
CREATE TABLE "users" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "email"              TEXT NOT NULL,
  "phone"              TEXT,
  "password_hash"      TEXT NOT NULL,
  "status"             "user_status" NOT NULL DEFAULT 'ACTIVE',
  "email_verified_at"  TIMESTAMPTZ(3),
  "phone_verified_at"  TIMESTAMPTZ(3),
  "mfa_enabled"        BOOLEAN NOT NULL DEFAULT FALSE,
  "mfa_secret_enc"     TEXT,
  "failed_login_count" INTEGER NOT NULL DEFAULT 0,
  "locked_until"       TIMESTAMPTZ(3),
  "last_login_at"      TIMESTAMPTZ(3),
  "created_at"         TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"         TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "deleted_at"         TIMESTAMPTZ(3)
);
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" (lower("email"));
CREATE UNIQUE INDEX "users_phone_key" ON "users" ("phone") WHERE "phone" IS NOT NULL;

CREATE TABLE "user_sessions" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"            UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "family_id"          UUID NOT NULL,
  "refresh_token_hash" TEXT NOT NULL UNIQUE,
  "replaced_by_id"     UUID REFERENCES "user_sessions"("id"),
  "user_agent"         TEXT,
  "ip_address"         TEXT,
  "expires_at"         TIMESTAMPTZ(3) NOT NULL,
  "revoked_at"         TIMESTAMPTZ(3),
  "revoked_reason"     TEXT,
  "created_at"         TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX "user_sessions_user_id_idx" ON "user_sessions" ("user_id");
CREATE INDEX "user_sessions_family_id_idx" ON "user_sessions" ("family_id");

CREATE TABLE "customer_profiles" (
  "user_id"              UUID PRIMARY KEY REFERENCES "users"("id") ON DELETE CASCADE,
  "first_name"           TEXT NOT NULL,
  "last_name"            TEXT NOT NULL,
  "date_of_birth"        DATE,
  "nationality"          CHAR(2) REFERENCES "countries"("code"),
  "country_of_residence" CHAR(2) NOT NULL REFERENCES "countries"("code"),
  "kyc_status"           "kyc_status" NOT NULL DEFAULT 'NOT_STARTED',
  "kyc_level"            SMALLINT NOT NULL DEFAULT 0,
  "created_at"           TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"           TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX "customer_profiles_kyc_status_idx" ON "customer_profiles" ("kyc_status");

CREATE TABLE "addresses" (
  "id"           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"      UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "line1"        TEXT NOT NULL,
  "line2"        TEXT,
  "city"         TEXT NOT NULL,
  "region"       TEXT,
  "postal_code"  TEXT,
  "country_code" CHAR(2) NOT NULL REFERENCES "countries"("code"),
  "is_primary"   BOOLEAN NOT NULL DEFAULT TRUE,
  "verified_at"  TIMESTAMPTZ(3),
  "created_at"   TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"   TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "deleted_at"   TIMESTAMPTZ(3)
);
CREATE INDEX "addresses_user_id_idx" ON "addresses" ("user_id");
CREATE UNIQUE INDEX "addresses_one_primary_key" ON "addresses" ("user_id") WHERE "is_primary" AND "deleted_at" IS NULL;

-- ---------------------------------------------------------------------------
-- Admin, roles, permissions
-- ---------------------------------------------------------------------------
CREATE TABLE "admin_users" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "email"          TEXT NOT NULL,
  "full_name"      TEXT NOT NULL,
  "password_hash"  TEXT NOT NULL,
  "mfa_enabled"    BOOLEAN NOT NULL DEFAULT FALSE,
  "mfa_secret_enc" TEXT,
  "status"         "user_status" NOT NULL DEFAULT 'ACTIVE',
  "last_login_at"  TIMESTAMPTZ(3),
  "created_at"     TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "admin_users_email_lower_key" ON "admin_users" (lower("email"));

CREATE TABLE "roles" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code"        TEXT NOT NULL UNIQUE,
  "name"        TEXT NOT NULL,
  "description" TEXT
);

CREATE TABLE "permissions" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code"        TEXT NOT NULL UNIQUE,
  "description" TEXT
);

CREATE TABLE "role_permissions" (
  "role_id"       UUID NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
  "permission_id" UUID NOT NULL REFERENCES "permissions"("id") ON DELETE CASCADE,
  PRIMARY KEY ("role_id", "permission_id")
);

CREATE TABLE "admin_user_roles" (
  "admin_user_id" UUID NOT NULL REFERENCES "admin_users"("id") ON DELETE CASCADE,
  "role_id"       UUID NOT NULL REFERENCES "roles"("id") ON DELETE CASCADE,
  PRIMARY KEY ("admin_user_id", "role_id")
);

-- ---------------------------------------------------------------------------
-- KYC
-- ---------------------------------------------------------------------------
CREATE TABLE "kyc_cases" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"           UUID NOT NULL REFERENCES "users"("id"),
  "provider"          TEXT NOT NULL DEFAULT 'MANUAL',
  "provider_case_ref" TEXT,
  "status"            "kyc_status" NOT NULL DEFAULT 'PENDING',
  "level"             SMALLINT NOT NULL DEFAULT 1,
  "rejection_reason"  TEXT,
  "reviewed_by_id"    UUID REFERENCES "admin_users"("id"),
  "reviewed_at"       TIMESTAMPTZ(3),
  "created_at"        TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"        TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX "kyc_cases_user_id_idx" ON "kyc_cases" ("user_id");
CREATE INDEX "kyc_cases_status_idx" ON "kyc_cases" ("status");

CREATE TABLE "identity_documents" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"             UUID NOT NULL REFERENCES "users"("id"),
  "kyc_case_id"         UUID REFERENCES "kyc_cases"("id"),
  "document_type"       TEXT NOT NULL,
  "issuing_country"     CHAR(2) NOT NULL REFERENCES "countries"("code"),
  "document_number_enc" TEXT,
  "expiry_date"         DATE,
  "storage_key"         TEXT,
  "provider_reference"  TEXT,
  "status"              "document_status" NOT NULL DEFAULT 'SUBMITTED',
  "rejection_reason"    TEXT,
  "reviewed_at"         TIMESTAMPTZ(3),
  "created_at"          TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX "identity_documents_user_id_idx" ON "identity_documents" ("user_id");

-- ---------------------------------------------------------------------------
-- Beneficiaries
-- ---------------------------------------------------------------------------
CREATE TABLE "beneficiaries" (
  "id"                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"                 UUID NOT NULL REFERENCES "users"("id"),
  "full_name"               TEXT NOT NULL,
  "nickname"                TEXT,
  "country_code"            CHAR(2) NOT NULL REFERENCES "countries"("code"),
  "payout_method"           "payout_method_type" NOT NULL,
  "mobile_operator_id"      UUID REFERENCES "mobile_operators"("id"),
  "msisdn"                  TEXT,
  "bank_name"               TEXT,
  "bank_code"               TEXT,
  "bank_account_number_enc" TEXT,
  "bank_account_last4"      CHAR(4),
  "created_at"              TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"              TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "deleted_at"              TIMESTAMPTZ(3),
  CONSTRAINT "beneficiaries_mobile_money_chk" CHECK (
    "payout_method" <> 'MOBILE_MONEY' OR ("mobile_operator_id" IS NOT NULL AND "msisdn" ~ '^[0-9]{8,15}$')
  ),
  CONSTRAINT "beneficiaries_bank_chk" CHECK (
    "payout_method" <> 'BANK_ACCOUNT' OR ("bank_code" IS NOT NULL AND "bank_account_number_enc" IS NOT NULL)
  )
);
CREATE INDEX "beneficiaries_user_id_idx" ON "beneficiaries" ("user_id") WHERE "deleted_at" IS NULL;
CREATE UNIQUE INDEX "beneficiaries_user_msisdn_key" ON "beneficiaries" ("user_id", "mobile_operator_id", "msisdn") WHERE "deleted_at" IS NULL AND "msisdn" IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Providers, rates, fees, quotes
-- ---------------------------------------------------------------------------
CREATE TABLE "payment_providers" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code"                 TEXT NOT NULL UNIQUE,
  "name"                 TEXT NOT NULL,
  "adapter"              TEXT NOT NULL,
  "environment"          "provider_environment" NOT NULL DEFAULT 'SANDBOX',
  "supported_currencies" TEXT[] NOT NULL DEFAULT '{}',
  "supported_countries"  TEXT[] NOT NULL DEFAULT '{}',
  "methods"              TEXT[] NOT NULL DEFAULT '{}',
  "config"               JSONB NOT NULL DEFAULT '{}',
  "credentials_ref"      TEXT,
  "priority"             INTEGER NOT NULL DEFAULT 0,
  "active"               BOOLEAN NOT NULL DEFAULT FALSE,
  "health_status"        TEXT NOT NULL DEFAULT 'UNKNOWN',
  "last_health_check_at" TIMESTAMPTZ(3),
  "created_at"           TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"           TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "payout_providers" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code"                  TEXT NOT NULL UNIQUE,
  "name"                  TEXT NOT NULL,
  "adapter"               TEXT NOT NULL,
  "environment"           "provider_environment" NOT NULL DEFAULT 'SANDBOX',
  "country_code"          CHAR(2) NOT NULL REFERENCES "countries"("code"),
  "payout_method"         "payout_method_type" NOT NULL,
  "mobile_operator_codes" TEXT[] NOT NULL DEFAULT '{}',
  "supported_currencies"  TEXT[] NOT NULL DEFAULT '{}',
  "config"                JSONB NOT NULL DEFAULT '{}',
  "credentials_ref"       TEXT,
  "priority"              INTEGER NOT NULL DEFAULT 0,
  "active"                BOOLEAN NOT NULL DEFAULT FALSE,
  "health_status"         TEXT NOT NULL DEFAULT 'UNKNOWN',
  "last_health_check_at"  TIMESTAMPTZ(3),
  "created_at"            TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"            TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

-- Append-only: new rates are inserted, never updated.
CREATE TABLE "exchange_rates" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "source_currency"      CHAR(3) NOT NULL REFERENCES "currencies"("code"),
  "destination_currency" CHAR(3) NOT NULL REFERENCES "currencies"("code"),
  "rate"                 NUMERIC(20,8) NOT NULL CHECK ("rate" > 0),
  "mid_rate"             NUMERIC(20,8),
  "margin_bps"           INTEGER,
  "kind"                 "rate_kind" NOT NULL,
  "source"               TEXT NOT NULL,
  "fetched_at"           TIMESTAMPTZ(3) NOT NULL,
  "valid_until"          TIMESTAMPTZ(3),
  "created_at"           TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX "exchange_rates_pair_fetched_idx" ON "exchange_rates" ("source_currency", "destination_currency", "fetched_at" DESC);

CREATE TABLE "fee_rules" (
  "id"                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code"                TEXT NOT NULL UNIQUE,
  "source_currency"     CHAR(3) NOT NULL REFERENCES "currencies"("code"),
  "destination_country" CHAR(2) NOT NULL REFERENCES "countries"("code"),
  "payout_method"       "payout_method_type",
  "min_send_amount"     NUMERIC(20,4) NOT NULL DEFAULT 0,
  "max_send_amount"     NUMERIC(20,4),
  "fixed_fee"           NUMERIC(20,4) NOT NULL DEFAULT 0 CHECK ("fixed_fee" >= 0),
  "percentage_bps"      INTEGER NOT NULL DEFAULT 0 CHECK ("percentage_bps" BETWEEN 0 AND 10000),
  "min_fee"             NUMERIC(20,4),
  "max_fee"             NUMERIC(20,4),
  "priority"            INTEGER NOT NULL DEFAULT 0,
  "active"              BOOLEAN NOT NULL DEFAULT TRUE,
  "valid_from"          TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "valid_to"            TIMESTAMPTZ(3),
  "created_at"          TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "fee_rules_band_chk" CHECK ("max_send_amount" IS NULL OR "max_send_amount" >= "min_send_amount")
);

CREATE TABLE "quotes" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"              UUID NOT NULL REFERENCES "users"("id"),
  "corridor_id"          TEXT NOT NULL REFERENCES "corridors"("id"),
  "payout_method"        "payout_method_type" NOT NULL,
  "send_amount"          NUMERIC(20,4) NOT NULL CHECK ("send_amount" > 0),
  "fee"                  NUMERIC(20,4) NOT NULL CHECK ("fee" >= 0),
  "total_payable"        NUMERIC(20,4) NOT NULL,
  "exchange_rate_id"     UUID NOT NULL REFERENCES "exchange_rates"("id"),
  "rate"                 NUMERIC(20,8) NOT NULL,
  "rate_kind"            "rate_kind" NOT NULL,
  "recipient_amount"     NUMERIC(20,4) NOT NULL CHECK ("recipient_amount" > 0),
  "fee_rule_id"          UUID NOT NULL REFERENCES "fee_rules"("id"),
  "expires_at"           TIMESTAMPTZ(3) NOT NULL,
  "used_at"              TIMESTAMPTZ(3),
  "created_at"           TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "quotes_total_chk" CHECK ("total_payable" = "send_amount" + "fee")
);
CREATE INDEX "quotes_user_id_idx" ON "quotes" ("user_id", "created_at" DESC);

-- ---------------------------------------------------------------------------
-- Transfers
-- ---------------------------------------------------------------------------
CREATE TABLE "transfers" (
  "id"                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "reference"            TEXT NOT NULL UNIQUE,
  "user_id"              UUID NOT NULL REFERENCES "users"("id"),
  "beneficiary_id"       UUID NOT NULL REFERENCES "beneficiaries"("id"),
  "beneficiary_snapshot" JSONB NOT NULL,
  "quote_id"             UUID NOT NULL UNIQUE REFERENCES "quotes"("id"),
  "corridor_id"          TEXT NOT NULL REFERENCES "corridors"("id"),
  "source_currency"      CHAR(3) NOT NULL REFERENCES "currencies"("code"),
  "destination_currency" CHAR(3) NOT NULL REFERENCES "currencies"("code"),
  "destination_country"  CHAR(2) NOT NULL REFERENCES "countries"("code"),
  "send_amount"          NUMERIC(20,4) NOT NULL CHECK ("send_amount" > 0),
  "fee"                  NUMERIC(20,4) NOT NULL CHECK ("fee" >= 0),
  "total_payable"        NUMERIC(20,4) NOT NULL,
  "exchange_rate"        NUMERIC(20,8) NOT NULL CHECK ("exchange_rate" > 0),
  "rate_kind"            "rate_kind" NOT NULL,
  "recipient_amount"     NUMERIC(20,4) NOT NULL CHECK ("recipient_amount" > 0),
  "payout_method"        "payout_method_type" NOT NULL,
  "payment_provider_id"  UUID REFERENCES "payment_providers"("id"),
  "payout_provider_id"   UUID REFERENCES "payout_providers"("id"),
  "status"               "transfer_status" NOT NULL DEFAULT 'DRAFT',
  "version"              INTEGER NOT NULL DEFAULT 0,
  "idempotency_key"      TEXT NOT NULL,
  "created_at"           TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"           TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "completed_at"         TIMESTAMPTZ(3),
  CONSTRAINT "transfers_total_chk" CHECK ("total_payable" = "send_amount" + "fee"),
  CONSTRAINT "transfers_user_idempotency_key" UNIQUE ("user_id", "idempotency_key")
);
CREATE INDEX "transfers_user_created_idx" ON "transfers" ("user_id", "created_at" DESC);
CREATE INDEX "transfers_status_idx" ON "transfers" ("status");
CREATE INDEX "transfers_created_idx" ON "transfers" ("created_at" DESC);

-- Append-only
CREATE TABLE "transfer_status_history" (
  "id"          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "transfer_id" UUID NOT NULL REFERENCES "transfers"("id"),
  "from_status" "transfer_status",
  "to_status"   "transfer_status" NOT NULL,
  "reason"      TEXT,
  "actor_type"  "actor_type" NOT NULL,
  "actor_id"    TEXT,
  "created_at"  TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX "transfer_status_history_transfer_idx" ON "transfer_status_history" ("transfer_id", "created_at");

CREATE TABLE "payment_attempts" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "transfer_id"        UUID NOT NULL REFERENCES "transfers"("id"),
  "provider_id"        UUID NOT NULL REFERENCES "payment_providers"("id"),
  "idempotency_key"    TEXT NOT NULL UNIQUE,
  "provider_reference" TEXT,
  "status"             "attempt_status" NOT NULL DEFAULT 'CREATED',
  "amount"             NUMERIC(20,4) NOT NULL CHECK ("amount" > 0),
  "currency"           CHAR(3) NOT NULL REFERENCES "currencies"("code"),
  "checkout_url"       TEXT,
  "failure_code"       TEXT,
  "failure_message"    TEXT,
  "last_response"      JSONB,
  "created_at"         TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"         TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX "payment_attempts_transfer_idx" ON "payment_attempts" ("transfer_id");
CREATE UNIQUE INDEX "payment_attempts_provider_ref_key" ON "payment_attempts" ("provider_id", "provider_reference") WHERE "provider_reference" IS NOT NULL;
-- Duplicate-payment prevention: at most one successful collection per transfer.
CREATE UNIQUE INDEX "payment_attempts_one_success_key" ON "payment_attempts" ("transfer_id") WHERE "status" = 'SUCCEEDED';
-- At most one in-flight collection per transfer.
CREATE UNIQUE INDEX "payment_attempts_one_open_key" ON "payment_attempts" ("transfer_id") WHERE "status" IN ('CREATED', 'PENDING', 'UNKNOWN');

CREATE TABLE "payout_attempts" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "transfer_id"        UUID NOT NULL REFERENCES "transfers"("id"),
  "provider_id"        UUID NOT NULL REFERENCES "payout_providers"("id"),
  "attempt_number"     INTEGER NOT NULL CHECK ("attempt_number" > 0),
  "idempotency_key"    TEXT NOT NULL UNIQUE,
  "provider_reference" TEXT,
  "status"             "attempt_status" NOT NULL DEFAULT 'CREATED',
  "amount"             NUMERIC(20,4) NOT NULL CHECK ("amount" > 0),
  "currency"           CHAR(3) NOT NULL REFERENCES "currencies"("code"),
  "failure_code"       TEXT,
  "failure_message"    TEXT,
  "last_response"      JSONB,
  "created_at"         TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"         TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "payout_attempts_number_key" UNIQUE ("transfer_id", "attempt_number")
);
CREATE UNIQUE INDEX "payout_attempts_provider_ref_key" ON "payout_attempts" ("provider_id", "provider_reference") WHERE "provider_reference" IS NOT NULL;
-- Duplicate-payout prevention: one success, and never two payouts in flight.
CREATE UNIQUE INDEX "payout_attempts_one_success_key" ON "payout_attempts" ("transfer_id") WHERE "status" = 'SUCCEEDED';
CREATE UNIQUE INDEX "payout_attempts_one_open_key" ON "payout_attempts" ("transfer_id") WHERE "status" IN ('CREATED', 'PENDING', 'UNKNOWN');

CREATE TABLE "provider_webhooks" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "provider_code"     TEXT NOT NULL,
  "event_id"          TEXT NOT NULL,
  "event_type"        TEXT,
  "signature_valid"   BOOLEAN NOT NULL,
  "headers"           JSONB NOT NULL DEFAULT '{}',
  "payload"           JSONB NOT NULL,
  "status"            "webhook_status" NOT NULL DEFAULT 'RECEIVED',
  "error"             TEXT,
  "received_at"       TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "processed_at"      TIMESTAMPTZ(3),
  CONSTRAINT "provider_webhooks_event_key" UNIQUE ("provider_code", "event_id")
);
CREATE INDEX "provider_webhooks_status_idx" ON "provider_webhooks" ("status", "received_at");

CREATE TABLE "refunds" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "transfer_id"        UUID NOT NULL REFERENCES "transfers"("id"),
  "payment_attempt_id" UUID NOT NULL REFERENCES "payment_attempts"("id"),
  "amount"             NUMERIC(20,4) NOT NULL CHECK ("amount" > 0),
  "currency"           CHAR(3) NOT NULL REFERENCES "currencies"("code"),
  "includes_fee"       BOOLEAN NOT NULL,
  "reason"             TEXT NOT NULL,
  "status"             "refund_status" NOT NULL DEFAULT 'REQUESTED',
  "provider_reference" TEXT,
  "requested_by_id"    UUID REFERENCES "admin_users"("id"),
  "approved_by_id"     UUID REFERENCES "admin_users"("id"),
  "created_at"         TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"         TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "refunds_four_eyes_chk" CHECK ("approved_by_id" IS NULL OR "approved_by_id" <> "requested_by_id")
);
-- One active/completed refund per transfer.
CREATE UNIQUE INDEX "refunds_one_active_key" ON "refunds" ("transfer_id") WHERE "status" NOT IN ('FAILED', 'REJECTED');

-- ---------------------------------------------------------------------------
-- Ledger (double entry, append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE "financial_accounts" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "code"       TEXT NOT NULL UNIQUE,
  "name"       TEXT NOT NULL,
  "type"       "account_type" NOT NULL,
  "currency"   CHAR(3) NOT NULL REFERENCES "currencies"("code"),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "ledger_transactions" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "event_type"      TEXT NOT NULL,
  "transfer_id"     UUID REFERENCES "transfers"("id"),
  "reverses_id"     UUID UNIQUE REFERENCES "ledger_transactions"("id"),
  "idempotency_key" TEXT NOT NULL UNIQUE,
  "description"     TEXT,
  "created_at"      TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX "ledger_transactions_transfer_idx" ON "ledger_transactions" ("transfer_id");

CREATE TABLE "ledger_entries" (
  "id"                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "ledger_transaction_id" UUID NOT NULL REFERENCES "ledger_transactions"("id"),
  "account_id"            UUID NOT NULL REFERENCES "financial_accounts"("id"),
  "side"                  "ledger_side" NOT NULL,
  "amount"                NUMERIC(20,4) NOT NULL CHECK ("amount" > 0),
  "currency"              CHAR(3) NOT NULL REFERENCES "currencies"("code"),
  "created_at"            TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX "ledger_entries_tx_idx" ON "ledger_entries" ("ledger_transaction_id");
CREATE INDEX "ledger_entries_account_idx" ON "ledger_entries" ("account_id", "created_at");

-- ---------------------------------------------------------------------------
-- Reconciliation
-- ---------------------------------------------------------------------------
CREATE TABLE "reconciliation_batches" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "source"         "recon_source" NOT NULL,
  "provider_code"  TEXT NOT NULL,
  "statement_date" DATE NOT NULL,
  "file_name"      TEXT,
  "file_sha256"    TEXT,
  "status"         "recon_batch_status" NOT NULL DEFAULT 'UPLOADED',
  "item_count"     INTEGER NOT NULL DEFAULT 0,
  "matched_count"  INTEGER NOT NULL DEFAULT 0,
  "exception_count" INTEGER NOT NULL DEFAULT 0,
  "created_by_id"  UUID REFERENCES "admin_users"("id"),
  "created_at"     TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "completed_at"   TIMESTAMPTZ(3),
  CONSTRAINT "reconciliation_batches_file_key" UNIQUE ("provider_code", "file_sha256")
);

CREATE TABLE "reconciliation_items" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "batch_id"           UUID NOT NULL REFERENCES "reconciliation_batches"("id"),
  "transfer_id"        UUID REFERENCES "transfers"("id"),
  "provider_reference" TEXT,
  "ebk_amount"         NUMERIC(20,4),
  "provider_amount"    NUMERIC(20,4),
  "currency"           CHAR(3) REFERENCES "currencies"("code"),
  "result"             "recon_result" NOT NULL,
  "notes"              TEXT,
  "resolved_at"        TIMESTAMPTZ(3),
  "resolved_by_id"     UUID REFERENCES "admin_users"("id"),
  "created_at"         TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX "reconciliation_items_batch_idx" ON "reconciliation_items" ("batch_id");
CREATE INDEX "reconciliation_items_open_idx" ON "reconciliation_items" ("result") WHERE "resolved_at" IS NULL AND "result" <> 'MATCHED';

-- ---------------------------------------------------------------------------
-- Notifications, support, compliance
-- ---------------------------------------------------------------------------
CREATE TABLE "notifications" (
  "id"         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"    UUID NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "channel"    "notification_channel" NOT NULL DEFAULT 'IN_APP',
  "type"       TEXT NOT NULL,
  "title"      TEXT NOT NULL,
  "body"       TEXT NOT NULL,
  "data"       JSONB NOT NULL DEFAULT '{}',
  "read_at"    TIMESTAMPTZ(3),
  "sent_at"    TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX "notifications_user_idx" ON "notifications" ("user_id", "created_at" DESC);

CREATE TABLE "support_tickets" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"        UUID NOT NULL REFERENCES "users"("id"),
  "transfer_id"    UUID REFERENCES "transfers"("id"),
  "subject"        TEXT NOT NULL,
  "status"         "ticket_status" NOT NULL DEFAULT 'OPEN',
  "priority"       SMALLINT NOT NULL DEFAULT 3,
  "assigned_to_id" UUID REFERENCES "admin_users"("id"),
  "created_at"     TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "closed_at"      TIMESTAMPTZ(3)
);
CREATE INDEX "support_tickets_status_idx" ON "support_tickets" ("status");

CREATE TABLE "support_notes" (
  "id"            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"       UUID NOT NULL REFERENCES "users"("id"),
  "ticket_id"     UUID REFERENCES "support_tickets"("id"),
  "admin_user_id" UUID NOT NULL REFERENCES "admin_users"("id"),
  "body"          TEXT NOT NULL,
  "created_at"    TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX "support_notes_user_idx" ON "support_notes" ("user_id");

CREATE TABLE "compliance_cases" (
  "id"             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"        UUID REFERENCES "users"("id"),
  "transfer_id"    UUID REFERENCES "transfers"("id"),
  "case_type"      TEXT NOT NULL,
  "status"         "case_status" NOT NULL DEFAULT 'OPEN',
  "priority"       SMALLINT NOT NULL DEFAULT 3,
  "summary"        TEXT NOT NULL,
  "resolution"     TEXT,
  "assigned_to_id" UUID REFERENCES "admin_users"("id"),
  "opened_by_id"   UUID REFERENCES "admin_users"("id"),
  "created_at"     TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updated_at"     TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "closed_at"      TIMESTAMPTZ(3),
  CONSTRAINT "compliance_cases_subject_chk" CHECK ("user_id" IS NOT NULL OR "transfer_id" IS NOT NULL)
);
CREATE INDEX "compliance_cases_status_idx" ON "compliance_cases" ("status");

CREATE TABLE "risk_flags" (
  "id"                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"            UUID REFERENCES "users"("id"),
  "transfer_id"        UUID REFERENCES "transfers"("id"),
  "rule_code"          TEXT NOT NULL,
  "severity"           "risk_severity" NOT NULL,
  "details"            JSONB NOT NULL DEFAULT '{}',
  "status"             "risk_flag_status" NOT NULL DEFAULT 'OPEN',
  "compliance_case_id" UUID REFERENCES "compliance_cases"("id"),
  "cleared_by_id"      UUID REFERENCES "admin_users"("id"),
  "cleared_at"         TIMESTAMPTZ(3),
  "created_at"         TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  CONSTRAINT "risk_flags_subject_chk" CHECK ("user_id" IS NOT NULL OR "transfer_id" IS NOT NULL)
);
CREATE INDEX "risk_flags_open_idx" ON "risk_flags" ("severity") WHERE "status" = 'OPEN';

-- ---------------------------------------------------------------------------
-- Audit, settings, idempotency
-- ---------------------------------------------------------------------------
CREATE TABLE "audit_logs" (
  "id"          BIGSERIAL PRIMARY KEY,
  "actor_type"  "actor_type" NOT NULL,
  "actor_id"    TEXT,
  "action"      TEXT NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id"   TEXT,
  "ip_address"  TEXT,
  "user_agent"  TEXT,
  "before"      JSONB,
  "after"       JSONB,
  "metadata"    JSONB NOT NULL DEFAULT '{}',
  "created_at"  TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" ("entity_type", "entity_id", "created_at");
CREATE INDEX "audit_logs_actor_idx" ON "audit_logs" ("actor_type", "actor_id", "created_at");

CREATE TABLE "system_settings" (
  "key"           TEXT PRIMARY KEY,
  "value"         JSONB NOT NULL,
  "description"   TEXT,
  "updated_by_id" UUID REFERENCES "admin_users"("id"),
  "updated_at"    TIMESTAMPTZ(3) NOT NULL DEFAULT now()
);

CREATE TABLE "idempotency_keys" (
  "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "scope"           TEXT NOT NULL,
  "key"             TEXT NOT NULL,
  "request_hash"    TEXT NOT NULL,
  "response_status" INTEGER,
  "response_body"   JSONB,
  "created_at"      TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "expires_at"      TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "idempotency_keys_scope_key_key" UNIQUE ("scope", "key")
);
CREATE INDEX "idempotency_keys_expires_idx" ON "idempotency_keys" ("expires_at");

-- ---------------------------------------------------------------------------
-- Integrity triggers
-- ---------------------------------------------------------------------------

-- Append-only tables: forbid UPDATE and DELETE. Corrections are new rows.
CREATE OR REPLACE FUNCTION ebk_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'EBK: % on % is not permitted (append-only table)', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$$;

CREATE TRIGGER "audit_logs_append_only" BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION ebk_forbid_mutation();
CREATE TRIGGER "ledger_entries_append_only" BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ebk_forbid_mutation();
CREATE TRIGGER "ledger_transactions_append_only" BEFORE UPDATE OR DELETE ON "ledger_transactions"
  FOR EACH ROW EXECUTE FUNCTION ebk_forbid_mutation();
CREATE TRIGGER "transfer_status_history_append_only" BEFORE UPDATE OR DELETE ON "transfer_status_history"
  FOR EACH ROW EXECUTE FUNCTION ebk_forbid_mutation();
CREATE TRIGGER "exchange_rates_append_only" BEFORE UPDATE OR DELETE ON "exchange_rates"
  FOR EACH ROW EXECUTE FUNCTION ebk_forbid_mutation();
-- TRUNCATE bypasses row triggers, so block it explicitly too.
CREATE TRIGGER "audit_logs_no_truncate" BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION ebk_forbid_mutation();
CREATE TRIGGER "ledger_entries_no_truncate" BEFORE TRUNCATE ON "ledger_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION ebk_forbid_mutation();

-- Ledger entries must use the account's currency.
CREATE OR REPLACE FUNCTION ebk_ledger_entry_currency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE acc_ccy CHAR(3);
BEGIN
  SELECT "currency" INTO acc_ccy FROM "financial_accounts" WHERE "id" = NEW."account_id";
  IF acc_ccy IS DISTINCT FROM NEW."currency" THEN
    RAISE EXCEPTION 'EBK: ledger entry currency % does not match account currency %', NEW."currency", acc_ccy;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "ledger_entries_currency" BEFORE INSERT ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION ebk_ledger_entry_currency();

-- Every ledger transaction must balance per currency, checked at COMMIT.
CREATE OR REPLACE FUNCTION ebk_ledger_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE bad RECORD; n INTEGER;
BEGIN
  SELECT count(*) INTO n FROM "ledger_entries" WHERE "ledger_transaction_id" = NEW."ledger_transaction_id";
  IF n < 2 THEN
    RAISE EXCEPTION 'EBK: ledger transaction % has fewer than two entries', NEW."ledger_transaction_id";
  END IF;
  SELECT "currency", sum(CASE WHEN "side" = 'DEBIT' THEN "amount" ELSE -"amount" END) AS diff INTO bad
    FROM "ledger_entries" WHERE "ledger_transaction_id" = NEW."ledger_transaction_id"
    GROUP BY "currency" HAVING sum(CASE WHEN "side" = 'DEBIT' THEN "amount" ELSE -"amount" END) <> 0 LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'EBK: ledger transaction % does not balance in % (difference %)', NEW."ledger_transaction_id", bad."currency", bad.diff;
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER "ledger_entries_balanced" AFTER INSERT ON "ledger_entries"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ebk_ledger_balanced();

-- Transfer status may only change along permitted transitions (mirror of @ebk/core).
CREATE OR REPLACE FUNCTION ebk_transfer_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."status" = OLD."status" THEN RETURN NEW; END IF;
  IF NOT (
    (OLD."status" = 'DRAFT'              AND NEW."status" IN ('PENDING_PAYMENT', 'CANCELLED')) OR
    (OLD."status" = 'PENDING_PAYMENT'    AND NEW."status" IN ('PAYMENT_PROCESSING', 'PAYMENT_RECEIVED', 'CANCELLED', 'FAILED')) OR
    (OLD."status" = 'PAYMENT_PROCESSING' AND NEW."status" IN ('PAYMENT_RECEIVED', 'FAILED')) OR
    (OLD."status" = 'PAYMENT_RECEIVED'   AND NEW."status" IN ('COMPLIANCE_REVIEW', 'PAYOUT_PROCESSING', 'REFUND_PENDING')) OR
    (OLD."status" = 'COMPLIANCE_REVIEW'  AND NEW."status" IN ('PAYOUT_PROCESSING', 'REFUND_PENDING')) OR
    (OLD."status" = 'PAYOUT_PROCESSING'  AND NEW."status" IN ('COMPLETED', 'COMPLIANCE_REVIEW', 'REFUND_PENDING')) OR
    (OLD."status" = 'REFUND_PENDING'     AND NEW."status" IN ('REFUNDED'))
  ) THEN
    RAISE EXCEPTION 'EBK: invalid transfer transition % -> %', OLD."status", NEW."status";
  END IF;
  IF NEW."version" <> OLD."version" + 1 THEN
    RAISE EXCEPTION 'EBK: transfer status change must increment version';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "transfers_transition" BEFORE UPDATE OF "status" ON "transfers"
  FOR EACH ROW EXECUTE FUNCTION ebk_transfer_transition();

-- Financial terms of a transfer are immutable once created.
CREATE OR REPLACE FUNCTION ebk_transfer_terms_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW."send_amount", NEW."fee", NEW."total_payable", NEW."exchange_rate", NEW."recipient_amount",
      NEW."source_currency", NEW."destination_currency", NEW."user_id", NEW."reference", NEW."beneficiary_snapshot")
     IS DISTINCT FROM
     (OLD."send_amount", OLD."fee", OLD."total_payable", OLD."exchange_rate", OLD."recipient_amount",
      OLD."source_currency", OLD."destination_currency", OLD."user_id", OLD."reference", OLD."beneficiary_snapshot") THEN
    RAISE EXCEPTION 'EBK: financial terms of transfer % cannot be changed', OLD."reference";
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "transfers_terms_immutable" BEFORE UPDATE ON "transfers"
  FOR EACH ROW EXECUTE FUNCTION ebk_transfer_terms_immutable();
CREATE TRIGGER "transfers_no_delete" BEFORE DELETE ON "transfers"
  FOR EACH ROW EXECUTE FUNCTION ebk_forbid_mutation();
