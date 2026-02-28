#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TESTS_DIR="${ROOT_DIR}/database/tests"

: "${POSTGRES_HOST:=localhost}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_DB:=cafeteria}"
: "${POSTGRES_USER:=cafeteria}"
: "${POSTGRES_PASSWORD:=cafeteria}"
: "${APPLY_MIGRATIONS:=true}"

export PGPASSWORD="${POSTGRES_PASSWORD}"

if ! command -v psql >/dev/null 2>&1; then
  echo "Error: psql is not installed or not in PATH"
  exit 1
fi

if [ "${APPLY_MIGRATIONS}" = "true" ]; then
  echo "Applying migrations before tests..."
  "${ROOT_DIR}/database/apply-migrations.sh"
fi

for file in "${TESTS_DIR}"/*.sql; do
  echo "Running $(basename "$file")"
  psql \
    --host "${POSTGRES_HOST}" \
    --port "${POSTGRES_PORT}" \
    --username "${POSTGRES_USER}" \
    --dbname "${POSTGRES_DB}" \
    --set ON_ERROR_STOP=1 \
    --file "${file}"
done

echo "All DB tests completed successfully."
