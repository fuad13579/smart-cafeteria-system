\echo 'Running DB integrity + performance checks (transactional, rollback at end)...'

BEGIN;

-- Test fixtures
INSERT INTO students (student_id, full_name, password)
VALUES ('dbtest-user', 'DB Test User', 'dbtest-pass')
ON CONFLICT (student_id) DO NOTHING;

INSERT INTO menu_items (id, name, price, available)
VALUES ('dbtest-item', 'DB Test Item', 99, TRUE)
ON CONFLICT (id) DO NOTHING;

INSERT INTO orders (id, student_id, status, eta_minutes, total_amount)
VALUES ('dbtest-order-1', 'dbtest-user', 'QUEUED', 10, 99)
ON CONFLICT (id) DO NOTHING;

INSERT INTO order_items (order_id, item_id, qty, unit_price)
VALUES ('dbtest-order-1', 'dbtest-item', 1, 99);

DO $$
BEGIN
    -- Constraint: valid order status
    BEGIN
        INSERT INTO orders (id, student_id, status, eta_minutes, total_amount)
        VALUES ('dbtest-order-invalid-status', 'dbtest-user', 'INVALID', 10, 100);
        RAISE EXCEPTION 'Expected invalid status to fail, but insert succeeded';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    -- Constraint: non-negative ETA
    BEGIN
        INSERT INTO orders (id, student_id, status, eta_minutes, total_amount)
        VALUES ('dbtest-order-invalid-eta', 'dbtest-user', 'QUEUED', -1, 100);
        RAISE EXCEPTION 'Expected negative eta_minutes to fail, but insert succeeded';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    -- Constraint: non-negative total
    BEGIN
        INSERT INTO orders (id, student_id, status, eta_minutes, total_amount)
        VALUES ('dbtest-order-invalid-total', 'dbtest-user', 'QUEUED', 10, -1);
        RAISE EXCEPTION 'Expected negative total_amount to fail, but insert succeeded';
    EXCEPTION
        WHEN check_violation THEN NULL;
    END;

    -- FK: order_items.order_id must exist
    BEGIN
        INSERT INTO order_items (order_id, item_id, qty, unit_price)
        VALUES ('dbtest-order-missing', 'dbtest-item', 1, 99);
        RAISE EXCEPTION 'Expected missing order FK to fail, but insert succeeded';
    EXCEPTION
        WHEN foreign_key_violation THEN NULL;
    END;

    -- FK: order_items.item_id must exist
    BEGIN
        INSERT INTO order_items (order_id, item_id, qty, unit_price)
        VALUES ('dbtest-order-1', 'dbtest-item-missing', 1, 99);
        RAISE EXCEPTION 'Expected missing menu item FK to fail, but insert succeeded';
    EXCEPTION
        WHEN foreign_key_violation THEN NULL;
    END;
END
$$;

DO $$
BEGIN
    -- Ensure critical indexes exist
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'idx_orders_student_created_at'
    ) THEN
        RAISE EXCEPTION 'Missing index: idx_orders_student_created_at';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'idx_order_items_order_id'
    ) THEN
        RAISE EXCEPTION 'Missing index: idx_order_items_order_id';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'public' AND indexname = 'idx_auth_tokens_student_created_at'
    ) THEN
        RAISE EXCEPTION 'Missing index: idx_auth_tokens_student_created_at';
    END IF;
END
$$;

\echo 'EXPLAIN: Recent orders by student'
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT id, status, created_at
FROM orders
WHERE student_id = 'dbtest-user'
ORDER BY created_at DESC
LIMIT 10;

\echo 'EXPLAIN: Order items by order_id'
EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
SELECT item_id, qty, unit_price
FROM order_items
WHERE order_id = 'dbtest-order-1';

\echo 'Sanity checks for views'
SELECT * FROM v_order_summary WHERE order_id = 'dbtest-order-1';
SELECT * FROM v_today_sales;

ROLLBACK;

\echo 'DB integrity + performance checks completed successfully.'
