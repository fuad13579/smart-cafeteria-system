INSERT INTO students (student_id, full_name, password, account_balance, is_active)
VALUES
    ('240041246', 'Fuad Bin Sattar', '$2b$12$fN1enJXGmcFGiaDk7SJNeO42qd4WUnsw2KCZdrCT3QmDbL2ItMyjO', 1500, TRUE),
    ('240041248', 'Mahrus Shams', '$2b$12$0aI28a4URPLvsefpffqnD.zwukxWb.T16rXCrunH8U7uX/buvGWFK', 1500, TRUE),
    ('240041250', 'Shahriar Hasnat', '$2b$12$sBbbQdPb.XQDWhteSWhebe1MZq64BUyfEnYYZjCVP5vUboiECL5MC', 1500, TRUE),
    ('admin-demo', 'Demo Admin', '$2b$12$BLpqza7rxEUzMWchTrJpJe8QYTJERLiXnK6sN/kQCJl2aSe9gS50u', 5000, TRUE)
ON CONFLICT (student_id) DO UPDATE
SET full_name = EXCLUDED.full_name,
    password = EXCLUDED.password,
    account_balance = EXCLUDED.account_balance,
    is_active = EXCLUDED.is_active;

INSERT INTO menu_items (id, name, price, stock_quantity, available)
VALUES
    ('1', 'Platter 1 (Khichuri + Chicken + Pickle)', 220, 40, TRUE),
    ('2', 'Platter 2 (Polao + Roast + Salad)', 280, 40, TRUE)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    price = EXCLUDED.price,
    stock_quantity = EXCLUDED.stock_quantity,
    available = EXCLUDED.available;

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
