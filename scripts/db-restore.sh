#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_HOST:=localhost}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_DB:=cafeteria}"
: "${POSTGRES_USER:=cafeteria}"
: "${POSTGRES_PASSWORD:=cafeteria}"
: "${RESET_DB:=false}"

if [ $# -lt 1 ]; then
  echo "Usage: $0 <backup-file.sql.gz|backup-file.sql>"
  exit 1
fi

backup_file="$1"
if [ ! -f "${backup_file}" ]; then
  echo "Error: file not found: ${backup_file}"
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "Error: psql is not installed or not in PATH."
  exit 1
fi

export PGPASSWORD="${POSTGRES_PASSWORD}"

if [ "${RESET_DB}" = "true" ]; then
  echo "RESET_DB=true: dropping and recreating schema public..."
  psql \
    --host "${POSTGRES_HOST}" \
    --port "${POSTGRES_PORT}" \
    --username "${POSTGRES_USER}" \
    --dbname "${POSTGRES_DB}" \
    --set ON_ERROR_STOP=1 \
    --command "DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;"
fi

echo "Restoring from ${backup_file} ..."
if [[ "${backup_file}" == *.gz ]]; then
  gunzip -c "${backup_file}" | psql \
    --host "${POSTGRES_HOST}" \
    --port "${POSTGRES_PORT}" \
    --username "${POSTGRES_USER}" \
    --dbname "${POSTGRES_DB}" \
    --set ON_ERROR_STOP=1
else
  psql \
    --host "${POSTGRES_HOST}" \
    --port "${POSTGRES_PORT}" \
    --username "${POSTGRES_USER}" \
    --dbname "${POSTGRES_DB}" \
    --set ON_ERROR_STOP=1 \
    --file "${backup_file}"
fi

echo "Restore completed."
