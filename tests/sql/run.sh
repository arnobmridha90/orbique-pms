#!/usr/bin/env bash
# Database tests on a local Postgres (14+). Creates two throwaway databases, applies a Supabase stand-in and every
# migration with scripts/migrate.mjs, re-applies 0006, 0007, 0009, 0010, 0011, 0014 and 0015 twice (they must be re-runnable), then runs the SQL
# tests.
#
#   PGURL=postgres://postgres@127.0.0.1:5432/postgres tests/sql/run.sh
#
# PGURL must be a superuser on a server you do not mind getting two databases (dropped and re-created each run).
set -euo pipefail
cd "$(dirname "$0")/../.."
: "${PGURL:?set PGURL to a superuser connection on a local test server}"

db_url() { node -e 'const u = new URL(process.argv[1]); u.pathname = "/" + process.argv[2]; console.log(u.toString())' "$PGURL" "$1"; }
psqlq() { psql -X -q -v ON_ERROR_STOP=1 "$@"; }

prepare() { # name, extra stub file (optional)
  local name="$1" url
  url="$(db_url "$name")"
  psqlq "$PGURL" -c "drop database if exists $name" -c "create database $name"
  psqlq "$url" -f tests/sql/supabase_stub.sql 2>&1 | grep -v -e 'wal_level' -e 'HINT:  Set wal_level' || true
  if [ -n "${2:-}" ]; then psqlq "$url" -f "$2"; fi
  echo "$url"
}

migrate_all() { # url
  local url="$1"
  DATABASE_URL="$url" node scripts/migrate.mjs
  DATABASE_URL="$url" node scripts/migrate.mjs                     # nothing left to apply
  # 0009 and 0014 replace functions from 0006, so they are re-run after it (in production each file runs once, in order)
  for f in 0006_channex.sql 0007_channex_cron.sql 0009_channex_fixes.sql 0010_inbox.sql 0011_alerts.sql 0014_listing_types.sql 0015_website_booking.sql; do
    DATABASE_URL="$url" node scripts/migrate.mjs --reapply "$f"   # re-run through the runner
    psqlq "$url" -f "supabase/migrations/$f" >/dev/null 2>&1 || { echo "re-running $f with psql failed"; psqlq "$url" -f "supabase/migrations/$f"; exit 1; }
  done
}

echo "== plain Postgres (no pg_cron, pg_net or Vault)"
URL1="$(prepare orbique_channex_test | tail -n 1)"
( unset CHANNEX_WORKER_SECRET APP_URL VERCEL_PROJECT_PRODUCTION_URL; migrate_all "$URL1" )
psqlq "$URL1" -f tests/sql/channex_triggers.sql 2>&1 | sed 's/^psql:[^:]*:[0-9]*: NOTICE:  /  /'

echo "== with stand-ins for Vault, pg_net and pg_cron"
URL2="$(prepare orbique_channex_ext_test tests/sql/supabase_ext_stub.sql | tail -n 1)"
( export CHANNEX_WORKER_SECRET="test-worker-secret-$(date +%s)" APP_URL="http://127.0.0.1:3000/"; unset VERCEL_ENV; migrate_all "$URL2" )
psqlq "$URL2" -f tests/sql/channex_cron.sql 2>&1 | sed 's/^psql:[^:]*:[0-9]*: NOTICE:  /  /'

echo "== guest units (0008)"
psqlq "$URL1" -f tests/sql/guest_units.sql 2>&1 | sed 's/^psql:[^:]*:[0-9]*: NOTICE:  /  /'

echo "== guest inbox (0010)"
psqlq "$URL1" -f tests/sql/inbox.sql 2>&1 | sed 's/^psql:[^:]*:[0-9]*: NOTICE:  /  /'

echo "== booking alerts (0011)"
psqlq "$URL1" -f tests/sql/alerts.sql 2>&1 | sed 's/^psql:[^:]*:[0-9]*: NOTICE:  /  /'

echo "== listing types (0014)"
psqlq "$URL1" -f tests/sql/listing_types.sql 2>&1 | sed 's/^psql:[^:]*:[0-9]*: NOTICE:  /  /'

echo "== website bookings (0015)"
psqlq "$URL1" -f tests/sql/website.sql 2>&1 | sed 's/^psql:[^:]*:[0-9]*: NOTICE:  /  /'
