CREATE OR REPLACE VIEW v_order_summary AS
SELECT
    o.id AS order_id,
    o.student_id,
    o.status,
    o.eta_minutes,
    o.total_amount,
    o.created_at,
    COUNT(oi.id) AS item_line_count,
    COALESCE(SUM(oi.qty), 0) AS total_qty
FROM orders o
LEFT JOIN order_items oi ON oi.order_id = o.id
GROUP BY o.id;

CREATE OR REPLACE VIEW v_today_sales AS
SELECT
    CURRENT_DATE AS day,
    COUNT(*) AS total_orders,
    COALESCE(SUM(total_amount), 0) AS total_revenue,
    COALESCE(AVG(total_amount), 0)::NUMERIC(10,2) AS avg_order_value
FROM orders
WHERE created_at >= date_trunc('day', NOW());
