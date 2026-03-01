INSERT INTO students (student_id, full_name, password, account_balance)
VALUES
    ('240041246', 'Fuad Bin Sattar', 'pass123', 1500),
    ('240041248', 'Mahrus Shams', 'pass 246', 1500),
    ('240041250', 'Shahriar Hasnat', 'pass 369', 1500),
    ('admin-demo', 'Demo Admin', 'admin-pass', 5000)
ON CONFLICT (student_id) DO NOTHING;

INSERT INTO menu_items (id, name, price, stock_quantity, available)
VALUES
    ('1', 'Platter 1 (Khichuri + Chicken + Pickle)', 220, 40, TRUE),
    ('2', 'Platter 2 (Polao + Roast + Salad)', 280, 40, TRUE)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    price = EXCLUDED.price,
    stock_quantity = EXCLUDED.stock_quantity,
    available = EXCLUDED.available;

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
ON CONFLICT DO NOTHING;
