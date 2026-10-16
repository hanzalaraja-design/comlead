#!/usr/bin/env bash
# Apply all migrations + seed to a throwaway local Postgres database and run
# the RLS tests. Needs psql access to a local Postgres (superuser).
#   PGURL=postgres://postgres@localhost:5432/postgres npm run db:test:local
set -euo pipefail
shopt -s nullglob

cd "$(dirname "$0")/.."
PGURL="${PGURL:-postgres://postgres@localhost:5432/postgres}"
DB="highfy_test_$$"

psql "$PGURL" -qX -v ON_ERROR_STOP=1 -c "create database $DB" >/dev/null
trap 'psql "$PGURL" -qX -c "drop database if exists $DB" >/dev/null' EXIT

TESTURL="${PGURL%/*}/$DB"
run() { psql "$TESTURL" -qX -v ON_ERROR_STOP=1 -f "$1"; }

run supabase/tests/local/supabase_shim.sql
for f in supabase/migrations/*.sql; do
  echo "migrate: $f"
  run "$f"
done
run supabase/seed.sql
run supabase/seed.sql   # seed must be re-runnable
echo "running supabase/tests/rls_test.sql"
psql "$TESTURL" -qX -v ON_ERROR_STOP=1 -o /dev/null -f supabase/tests/rls_test.sql 2>&1 | sed "s/^psql:[^ ]* NOTICE:  //"
echo "ALL RLS TESTS PASSED"
