CREATE TABLE IF NOT EXISTS students (
    student_id TEXT PRIMARY KEY,
    full_name TEXT NOT NULL,
    password TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menu_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    price INTEGER NOT NULL CHECK (price >= 0),
    available BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    student_id TEXT REFERENCES students(student_id),
    status TEXT NOT NULL,
    eta_minutes INTEGER NOT NULL DEFAULT 12,
    total_amount INTEGER NOT NULL DEFAULT 0,
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
