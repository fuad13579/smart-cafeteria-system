CREATE SEQUENCE IF NOT EXISTS order_token_seq START WITH 1001 INCREMENT BY 1;

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS token_no BIGINT;

UPDATE orders
SET token_no = nextval('order_token_seq')
WHERE token_no IS NULL;

ALTER TABLE orders
    ALTER COLUMN token_no SET DEFAULT nextval('order_token_seq');

ALTER TABLE orders
    ALTER COLUMN token_no SET NOT NULL;

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS pickup_counter INT NOT NULL DEFAULT 1;

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS ready_at TIMESTAMPTZ;

ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS ready_until TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS ux_orders_token_no
    ON orders (token_no);
