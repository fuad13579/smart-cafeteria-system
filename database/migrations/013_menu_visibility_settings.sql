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
