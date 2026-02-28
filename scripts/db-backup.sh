#!/usr/bin/env bash
set -euo pipefail

: "${POSTGRES_HOST:=localhost}"
: "${POSTGRES_PORT:=5432}"
: "${POSTGRES_DB:=cafeteria}"
: "${POSTGRES_USER:=cafeteria}"
: "${POSTGRES_PASSWORD:=cafeteria}"
: "${BACKUP_DIR:=./backups/db}"

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "Error: pg_dump is not installed or not in PATH."
  exit 1
fi

mkdir -p "${BACKUP_DIR}"
timestamp="$(date +%Y%m%d_%H%M%S)"
outfile="${BACKUP_DIR}/${POSTGRES_DB}_${timestamp}.sql.gz"

export PGPASSWORD="${POSTGRES_PASSWORD}"

pg_dump \
  --host "${POSTGRES_HOST}" \
  --port "${POSTGRES_PORT}" \
  --username "${POSTGRES_USER}" \
  --dbname "${POSTGRES_DB}" \
  --no-owner \
  --no-privileges \
  | gzip > "${outfile}"

echo "Backup created: ${outfile}"
