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

INSERT INTO menu_slots (main, slot, is_active)
VALUES
    ('regular', 'breakfast', TRUE),
    ('regular', 'lunch', TRUE),
    ('regular', 'dinner', TRUE),
    ('ramadan', 'iftar', TRUE),
    ('ramadan', 'suhoor', TRUE)
ON CONFLICT (main, slot) DO NOTHING;

INSERT INTO menu_item_slots (slot_id, item_id)
SELECT ms.id, mi.id
FROM menu_slots ms
CROSS JOIN menu_items mi
WHERE NOT EXISTS (
    SELECT 1 FROM menu_item_slots mis
    WHERE mis.slot_id = ms.id
)
ON CONFLICT DO NOTHING;
