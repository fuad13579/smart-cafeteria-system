# Database Migrations

## Structure
- `migrations/001_init.sql` - base schema
- `migrations/002_seed.sql` - seed data
- `migrations/003_indexes.sql` - performance indexes
- `migrations/004_audit.sql` - `updated_at` columns + triggers
- `migrations/005_views.sql` - analytics and summary views
- `migrations/006_constraints.sql` - data integrity constraints

## Apply migrations
Run from repo root:

```bash
./database/apply-migrations.sh
```

Optional overrides:

```bash
POSTGRES_HOST=localhost \
POSTGRES_PORT=5432 \
POSTGRES_DB=cafeteria \
POSTGRES_USER=cafeteria \
POSTGRES_PASSWORD=cafeteria \
./database/apply-migrations.sh
```

## Notes
- Migrations are idempotent where possible (`IF NOT EXISTS`, `OR REPLACE`).
- Apply in filename order only.

## Backup and restore
Run from repo root:

```bash
./scripts/db-backup.sh
```

Restore from a backup file:

```bash
./scripts/db-restore.sh ./backups/db/cafeteria_YYYYMMDD_HHMMSS.sql.gz
```

Optional env overrides:

```bash
POSTGRES_HOST=localhost \
POSTGRES_PORT=5432 \
POSTGRES_DB=cafeteria \
POSTGRES_USER=cafeteria \
POSTGRES_PASSWORD=cafeteria \
./scripts/db-backup.sh
```

Reset schema before restore (destructive on current DB):

```bash
RESET_DB=true ./scripts/db-restore.sh ./backups/db/cafeteria_YYYYMMDD_HHMMSS.sql.gz
```

## DB tests
Run automated DB checks:

```bash
./database/run-db-tests.sh
```

or:

```bash
make db-test
```

Skip migration execution step:

```bash
APPLY_MIGRATIONS=false ./database/run-db-tests.sh
```

See full checklist:
- `database/TEST_CHECKLIST.md`
