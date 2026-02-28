# Database Test Checklist

## Goal
Validate DB integrity, constraints, and index readiness before backend integration.

## Automated checks
Run from repo root:

```bash
./database/run-db-tests.sh
```

This script:
- applies migrations (default)
- runs SQL integrity checks
- verifies critical indexes exist
- prints `EXPLAIN ANALYZE` for key query paths
- runs transactionally and rolls test data back

## Manual checks
1. Migration order:
- Ensure `database/migrations/*.sql` executes in ascending order.

2. Data constraints:
- Invalid `orders.status` is rejected.
- Negative `eta_minutes` is rejected.
- Negative `total_amount` is rejected.
- Blank names/tokens are rejected.

3. Foreign key safety:
- `order_items.order_id` must reference an existing order.
- `order_items.item_id` must reference an existing menu item.

4. Performance readiness:
- Verify index presence in `pg_indexes`.
- Review `EXPLAIN ANALYZE` output for:
  - orders by `student_id` + `created_at`
  - order_items by `order_id`

5. Views sanity:
- `v_order_summary` returns expected aggregate rows.
- `v_today_sales` returns today-level aggregate metrics.

## Optional toggles
- Skip migration step:
  - `APPLY_MIGRATIONS=false ./database/run-db-tests.sh`
