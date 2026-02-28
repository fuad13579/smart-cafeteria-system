INSERT INTO students (student_id, full_name, password, is_active)
VALUES
    ('2100001', 'Ayesha Rahman', 'demo-pass', TRUE),
    ('2100002', 'Mahdi Hasan', 'demo-pass', TRUE),
    ('2100003', 'Nafisa Karim', 'demo-pass', TRUE),
    ('admin-demo', 'Demo Admin', 'admin-pass', TRUE)
ON CONFLICT (student_id) DO UPDATE
SET full_name = EXCLUDED.full_name,
    password = EXCLUDED.password,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

INSERT INTO menu_items (id, name, price, available)
VALUES
    ('1', 'Chicken Burger', 120, TRUE),
    ('2', 'Beef Burger', 150, TRUE),
    ('3', 'French Fries', 60, FALSE),
    ('4', 'Water', 20, TRUE),
    ('5', 'Noodles', 110, TRUE),
    ('6', 'Tea', 15, TRUE)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    price = EXCLUDED.price,
    available = EXCLUDED.available,
    updated_at = NOW();
