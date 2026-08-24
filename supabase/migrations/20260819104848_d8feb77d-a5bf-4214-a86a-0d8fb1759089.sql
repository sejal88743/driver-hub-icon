ALTER TABLE public.bills
  ADD COLUMN IF NOT EXISTS "user" text,
  ADD COLUMN IF NOT EXISTS "owner" text,
  ADD COLUMN IF NOT EXISTS "edit_date" text;