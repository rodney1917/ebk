#!/usr/bin/env bash
# Applies all migrations to a throwaway database and runs the SQL integrity tests.
# Usage: DATABASE_ADMIN_URL=postgres://postgres:postgres@localhost:5432/postgres ./test/db/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
ADMIN_URL="${DATABASE_ADMIN_URL:-postgres://postgres:postgres@localhost:5432/postgres}"
DB="ebk_schema_test_$$"
TEST_URL="${ADMIN_URL%/*}/${DB}"
psql "$ADMIN_URL" -q -c "CREATE DATABASE ${DB}"
trap 'psql "$ADMIN_URL" -q -c "DROP DATABASE IF EXISTS ${DB}"' EXIT
for m in prisma/migrations/*/migration.sql; do
  psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f "$m"
done
psql "$TEST_URL" -v ON_ERROR_STOP=1 -q -f test/db/schema.test.sql
