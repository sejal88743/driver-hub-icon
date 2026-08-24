DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'bills_bill_no_unique'
      AND conrelid = 'public.bills'::regclass
  ) THEN
    ALTER TABLE public.bills
      ADD CONSTRAINT bills_bill_no_unique UNIQUE (bill_no);
  END IF;
END $$;