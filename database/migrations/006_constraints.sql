DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_orders_status_valid'
    ) THEN
        ALTER TABLE orders
            ADD CONSTRAINT chk_orders_status_valid
            CHECK (status IN ('QUEUED', 'IN_PROGRESS', 'READY', 'COMPLETED', 'CANCELLED'));
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_orders_eta_non_negative'
    ) THEN
        ALTER TABLE orders
            ADD CONSTRAINT chk_orders_eta_non_negative
            CHECK (eta_minutes >= 0);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_orders_total_non_negative'
    ) THEN
        ALTER TABLE orders
            ADD CONSTRAINT chk_orders_total_non_negative
            CHECK (total_amount >= 0);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_menu_items_name_not_blank'
    ) THEN
        ALTER TABLE menu_items
            ADD CONSTRAINT chk_menu_items_name_not_blank
            CHECK (length(btrim(name)) > 0);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_students_name_not_blank'
    ) THEN
        ALTER TABLE students
            ADD CONSTRAINT chk_students_name_not_blank
            CHECK (length(btrim(full_name)) > 0);
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_auth_tokens_not_blank'
    ) THEN
        ALTER TABLE auth_tokens
            ADD CONSTRAINT chk_auth_tokens_not_blank
            CHECK (length(btrim(token)) > 0);
    END IF;
END
$$;
