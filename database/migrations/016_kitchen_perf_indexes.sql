CREATE INDEX IF NOT EXISTS idx_orders_status_created_at
    ON orders (status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id_id
    ON order_items (order_id, id);
