INSERT INTO students (student_id, full_name, password, account_balance)
VALUES
    ('240041246', 'Fuad Bin Sattar', 'pass123', 1500),
    ('240041248', 'Mahrus Shams', 'pass 246', 1500),
    ('240041250', 'Shahriar Hasnat', 'pass 369', 1500)
ON CONFLICT (student_id) DO NOTHING;

INSERT INTO menu_items (id, name, price, stock_quantity, available)
VALUES
    ('1', 'Chicken Burger', 120, 30, TRUE),
    ('2', 'Beef Burger', 150, 25, TRUE),
    ('3', 'French Fries', 60, 0, FALSE),
    ('4', 'Water', 20, 100, TRUE)
ON CONFLICT (id) DO NOTHING;
