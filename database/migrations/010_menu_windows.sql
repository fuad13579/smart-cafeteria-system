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
