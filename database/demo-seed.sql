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
    ('1', 'Chicken Burger', 120, 30, TRUE),
    ('2', 'Beef Burger', 150, 25, TRUE),
    ('3', 'French Fries', 60, 0, FALSE),
    ('4', 'Water', 20, 100, TRUE),
    ('5', 'Noodles', 110, 35, TRUE),
    ('6', 'Tea', 15, 120, TRUE)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    price = EXCLUDED.price,
    stock_quantity = EXCLUDED.stock_quantity,
    available = EXCLUDED.available,
    updated_at = NOW();
