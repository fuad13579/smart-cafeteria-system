DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'students'
          AND column_name = 'account_balance'
    ) THEN
        ALTER TABLE students
            ADD COLUMN account_balance INTEGER NOT NULL DEFAULT 0;
    END IF;
END
$$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'chk_students_account_balance_non_negative'
    ) THEN
        ALTER TABLE students
            ADD CONSTRAINT chk_students_account_balance_non_negative
            CHECK (account_balance >= 0);
    END IF;
END
$$;
