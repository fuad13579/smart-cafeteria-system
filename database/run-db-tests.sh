#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TESTS_DIR="${SCRIPT_DIR}/tests"

: "${POSTGRES_HOST:=}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_DB:=cafeteria}"
: "${POSTGRES_USER:=cafeteria}"
: "${POSTGRES_PASSWORD:=cafeteria}"
: "${APPLY_MIGRATIONS:=true}"
RETRY_COUNT="${RETRY_COUNT:-30}"
RETRY_DELAY_SEC="${RETRY_DELAY_SEC:-1}"

export PGPASSWORD="${POSTGRES_PASSWORD}"

if ! command -v psql >/dev/null 2>&1; then
  echo "Error: psql is not installed or not in PATH"
  exit 1
fi

psql_base=(
  psql
  --username "${POSTGRES_USER}"
  --dbname "${POSTGRES_DB}"
  --set ON_ERROR_STOP=1
)

if [[ -n "${POSTGRES_HOST}" ]]; then
  psql_base+=(--host "${POSTGRES_HOST}")
fi

if [[ -n "${POSTGRES_PORT}" ]]; then
  psql_base+=(--port "${POSTGRES_PORT}")
fi

attempt=1
until "${psql_base[@]}" --command "SELECT 1" >/dev/null 2>&1; do
  if [[ "${attempt}" -ge "${RETRY_COUNT}" ]]; then
    echo "Error: database is not ready after ${RETRY_COUNT} attempts"
    exit 1
  fi
  echo "Waiting for database to be ready (${attempt}/${RETRY_COUNT})..."
  sleep "${RETRY_DELAY_SEC}"
  attempt=$((attempt + 1))
done

if [ "${APPLY_MIGRATIONS}" = "true" ]; then
  echo "Applying migrations before tests..."
  "${SCRIPT_DIR}/apply-migrations.sh"
fi

for file in "${TESTS_DIR}"/*.sql; do
  echo "Running $(basename "$file")"
  "${psql_base[@]}" --file "${file}"
done

echo "All DB tests completed successfully."
