CREATE TABLE IF NOT EXISTS students (
    student_id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    password TEXT NOT NULL,
    account_balance INTEGER NOT NULL DEFAULT 0 CHECK (account_balance >= 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menu_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price INTEGER NOT NULL CHECK (price >= 0),
    stock_quantity INTEGER NOT NULL DEFAULT 20 CHECK (stock_quantity >= 0),
    available BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menu_slots (
    id BIGSERIAL PRIMARY KEY,
    main TEXT NOT NULL CHECK (main IN ('regular', 'ramadan')),
    slot TEXT NOT NULL CHECK (slot IN ('breakfast', 'lunch', 'dinner', 'iftar', 'suhoor')),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (main, slot),
    CHECK (
        (main = 'regular' AND slot IN ('breakfast', 'lunch', 'dinner'))
        OR
        (main = 'ramadan' AND slot IN ('iftar', 'suhoor'))
    )
);

CREATE TABLE IF NOT EXISTS menu_item_slots (
    slot_id BIGINT NOT NULL REFERENCES menu_slots(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (slot_id, item_id)
);

CREATE TABLE IF NOT EXISTS menu_visibility_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    ramadan_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    ramadan_start_at TIMESTAMPTZ,
    ramadan_end_at TIMESTAMPTZ,
    timezone TEXT NOT NULL DEFAULT 'Asia/Dhaka',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO menu_visibility_settings (id, ramadan_enabled, timezone)
VALUES (1, TRUE, 'Asia/Dhaka')
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS menu_windows (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL CHECK (name IN ('iftar', 'saheri')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    timezone TEXT NOT NULL DEFAULT 'Asia/Dhaka',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (start_date <= end_date)
);

CREATE TABLE IF NOT EXISTS menu_item_windows (
    window_id BIGINT NOT NULL REFERENCES menu_windows(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (window_id, item_id)
);

CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    student_id TEXT REFERENCES students(student_id),
    status TEXT NOT NULL,
    eta_minutes INTEGER NOT NULL DEFAULT 12,
    total_amount INTEGER NOT NULL DEFAULT 0,
    token_no BIGINT NOT NULL UNIQUE,
    printed_at TIMESTAMPTZ,
    slip_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_items (
    id BIGSERIAL PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    item_id TEXT NOT NULL REFERENCES menu_items(id),
    qty INTEGER NOT NULL CHECK (qty > 0),
    unit_price INTEGER NOT NULL CHECK (unit_price >= 0)
);

CREATE TABLE IF NOT EXISTS auth_tokens (
    token TEXT PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

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

CREATE TABLE IF NOT EXISTS wallet_topups (
    id BIGSERIAL PRIMARY KEY,
    topup_id TEXT NOT NULL UNIQUE,
    student_id TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    amount INTEGER NOT NULL CHECK (amount > 0),
    method TEXT NOT NULL CHECK (method IN ('BANK', 'BKASH', 'NAGAD')),
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
    provider_ref TEXT,
    idempotency_key TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_wallet_topups_student_key
    ON wallet_topups(student_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS wallet_transactions (
    id BIGSERIAL PRIMARY KEY,
    student_id TEXT NOT NULL REFERENCES students(student_id) ON DELETE CASCADE,
    txn_type TEXT NOT NULL CHECK (txn_type IN ('TOPUP', 'ORDER_PAYMENT', 'ADJUSTMENT')),
    direction TEXT NOT NULL CHECK (direction IN ('CREDIT', 'DEBIT')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    balance_before INTEGER NOT NULL CHECK (balance_before >= 0),
    balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
    reference_type TEXT NOT NULL,
    reference_id TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS event_outbox (
    id BIGSERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    queue_name TEXT NOT NULL,
    payload JSONB NOT NULL,
    published_at TIMESTAMPTZ,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_event_outbox_unpublished_created
    ON event_outbox (created_at)
    WHERE published_at IS NULL;
