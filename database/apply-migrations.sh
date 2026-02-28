#!/usr/bin/env bash
set -euo pipefail

MIGRATIONS_DIR="$(cd "$(dirname "$0")/migrations" && pwd)"

: "${POSTGRES_HOST:=localhost}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_DB:=cafeteria}"
: "${POSTGRES_USER:=cafeteria}"
: "${POSTGRES_PASSWORD:=cafeteria}"

export PGPASSWORD="${POSTGRES_PASSWORD}"

if ! command -v psql >/dev/null 2>&1; then
  echo "Error: psql is not installed or not in PATH"
  exit 1
fi

for file in "${MIGRATIONS_DIR}"/*.sql; do
  echo "Applying $(basename "$file")"
  psql \
    --host "${POSTGRES_HOST}" \
    --port "${POSTGRES_PORT}" \
    --username "${POSTGRES_USER}" \
    --dbname "${POSTGRES_DB}" \
    --set ON_ERROR_STOP=1 \
    --file "$file"
done

echo "All migrations applied successfully."
