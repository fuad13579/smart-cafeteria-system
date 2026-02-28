CREATE INDEX IF NOT EXISTS idx_orders_student_created_at
    ON orders (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_orders_created_at
    ON orders (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id
    ON order_items (order_id);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_student_created_at
    ON auth_tokens (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_menu_items_available_true
    ON menu_items (id)
    WHERE available = TRUE;
