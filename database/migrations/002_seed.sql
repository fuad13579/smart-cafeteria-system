INSERT INTO students (student_id, full_name, password)
VALUES
    ('2100001', 'Ayesha Rahman', 'demo-pass'),
    ('2100002', 'Mahdi Hasan', 'demo-pass'),
    ('2100003', 'Nafisa Karim', 'demo-pass')
ON CONFLICT (student_id) DO NOTHING;

INSERT INTO menu_items (id, name, price, available)
VALUES
    ('1', 'Chicken Burger', 120, TRUE),
    ('2', 'Beef Burger', 150, TRUE),
    ('3', 'French Fries', 60, FALSE),
    ('4', 'Water', 20, TRUE)
ON CONFLICT (id) DO NOTHING;
