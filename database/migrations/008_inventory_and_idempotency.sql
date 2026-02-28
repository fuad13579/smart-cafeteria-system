DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'menu_items'
          AND column_name = 'stock_quantity'
    ) THEN
        ALTER TABLE menu_items
            ADD COLUMN stock_quantity INTEGER NOT NULL DEFAULT 20;
    END IF;
END
$$;

UPDATE menu_items
SET stock_quantity = CASE WHEN available THEN 20 ELSE 0 END
WHERE stock_quantity IS NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_menu_items_stock_non_negative'
    ) THEN
        ALTER TABLE menu_items
            ADD CONSTRAINT chk_menu_items_stock_non_negative
            CHECK (stock_quantity >= 0);
    END IF;
END
$$;

CREATE TABLE IF NOT EXISTS stock_reservations (
    id BIGSERIAL PRIMARY KEY,
    order_id TEXT NOT NULL,
    item_id TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    qty INTEGER NOT NULL CHECK (qty > 0),
    status TEXT NOT NULL DEFAULT 'RESERVED' CHECK (status IN ('RESERVED', 'RELEASED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(order_id, item_id)
);

CREATE TABLE IF NOT EXISTS order_idempotency (
    id BIGSERIAL PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(student_id, idempotency_key)
);
