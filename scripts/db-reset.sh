#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_HOST:=localhost}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_DB:=cafeteria}"
: "${POSTGRES_USER:=cafeteria}"
: "${POSTGRES_PASSWORD:=cafeteria}"

if ! command -v psql >/dev/null 2>&1; then
  echo "Error: psql is not installed or not in PATH"
  exit 1
fi

export PGPASSWORD="${POSTGRES_PASSWORD}"

echo "Resetting database schema for ${POSTGRES_DB}..."
psql \
  --host "${POSTGRES_HOST}" \
  --port "${POSTGRES_PORT}" \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" \
  --set ON_ERROR_STOP=1 \
  --command "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"

echo "Applying migrations..."
./database/apply-migrations.sh

echo "Database reset completed."
