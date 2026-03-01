INSERT INTO students (student_id, full_name, password, account_balance, is_active)
VALUES
    ('240041246', 'Fuad Bin Sattar', 'pass123', 1500, TRUE),
    ('240041248', 'Mahrus Shams', 'pass 246', 1500, TRUE),
    ('240041250', 'Shahriar Hasnat', 'pass 369', 1500, TRUE),
    ('admin-demo', 'Demo Admin', 'admin-pass', 5000, TRUE)
ON CONFLICT (student_id) DO UPDATE
SET full_name = EXCLUDED.full_name,
    password = EXCLUDED.password,
    account_balance = EXCLUDED.account_balance,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

INSERT INTO menu_items (id, name, price, stock_quantity, available)
VALUES
    ('1', 'Platter 1 (Khichuri + Chicken + Pickle)', 220, 40, TRUE),
    ('2', 'Platter 2 (Polao + Roast + Salad)', 280, 40, TRUE)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    price = EXCLUDED.price,
    stock_quantity = EXCLUDED.stock_quantity,
    available = EXCLUDED.available,
    updated_at = NOW();

DELETE FROM menu_items WHERE id NOT IN ('1', '2');

INSERT INTO menu_windows (name, start_date, end_date, start_time, end_time, timezone, is_active)
VALUES
    ('iftar', '2026-03-01', '2026-03-31', '17:45:00', '20:30:00', 'Asia/Dhaka', TRUE),
    ('saheri', '2026-03-01', '2026-03-31', '02:30:00', '04:45:00', 'Asia/Dhaka', TRUE)
ON CONFLICT DO NOTHING;

INSERT INTO menu_item_windows (window_id, item_id)
SELECT mw.id, mi.id
FROM menu_windows mw
JOIN menu_items mi ON TRUE
WHERE mw.name IN ('iftar', 'saheri')
  AND mi.id IN ('1', '2')
ON CONFLICT DO NOTHING;

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
JOIN menu_items mi ON TRUE
WHERE mi.id IN ('1', '2')
ON CONFLICT DO NOTHING;
