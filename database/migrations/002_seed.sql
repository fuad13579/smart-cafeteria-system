INSERT INTO students (student_id, full_name, password, account_balance)
VALUES
    ('240041246', 'Fuad Bin Sattar', '$2b$12$fN1enJXGmcFGiaDk7SJNeO42qd4WUnsw2KCZdrCT3QmDbL2ItMyjO', 1500),
    ('240041248', 'Mahrus Shams', '$2b$12$0aI28a4URPLvsefpffqnD.zwukxWb.T16rXCrunH8U7uX/buvGWFK', 1500),
    ('240041250', 'Shahriar Hasnat', '$2b$12$sBbbQdPb.XQDWhteSWhebe1MZq64BUyfEnYYZjCVP5vUboiECL5MC', 1500),
    ('admin-demo', 'Demo Admin', '$2b$12$BLpqza7rxEUzMWchTrJpJe8QYTJERLiXnK6sN/kQCJl2aSe9gS50u', 5000)
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
