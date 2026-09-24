-- ==============================================================================
-- VitraTrack / Driver Hub - Complete Supabase PostgreSQL Schema Script
-- Run this in Supabase SQL Editor:
-- Dashboard -> SQL Editor -> New Query -> Paste & Run
-- ==============================================================================

-- 1. EXTENSIONS
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. TABLES CREATION
-- ==============================================================================

-- 2.1 BILLS TABLE
CREATE TABLE IF NOT EXISTS public.bills (
  id text PRIMARY KEY,
  sr_no text NOT NULL DEFAULT '',
  date text NOT NULL DEFAULT '',
  salesperson_name text NOT NULL DEFAULT '',
  collection_code text NOT NULL DEFAULT '',
  bill_no text NOT NULL UNIQUE,
  party_code text NOT NULL DEFAULT '',
  party_hul_code text NOT NULL DEFAULT '',
  party_name text NOT NULL DEFAULT '',
  beat_name text NOT NULL DEFAULT '',
  bill_net_amt real NOT NULL DEFAULT 0,
  collected_amount real NOT NULL DEFAULT 0,
  outstanding_amount real NOT NULL DEFAULT 0,
  bill_ageing real NOT NULL DEFAULT 0,
  line_cut_amt real NOT NULL DEFAULT 0,
  cash_amount real,
  upi_amount real,
  cheque_amount real,
  payment_mode text,
  payment_method text,
  payment_date text,
  payment_time text,
  driver_name text,
  delivery_date text,
  cheque_no text,
  cheque_date text,
  bank_name text,
  next_bill_no text,
  cancel_line text,
  discrepancy_reason text,
  "user" text,
  "owner" text,
  edit_date text,
  del_pending_history jsonb DEFAULT '[]'::jsonb,
  edit_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at timestamptz DEFAULT now()
);

-- Ensure all columns exist in case table already exists
DO $$ 
BEGIN
  ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS line_cut_amt real NOT NULL DEFAULT 0;
  ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS payment_method text;
  ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS "user" text;
  ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS "owner" text;
  ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS edit_date text;
  ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS del_pending_history jsonb DEFAULT '[]'::jsonb;
  ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS edit_history jsonb NOT NULL DEFAULT '[]'::jsonb;
  ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 2.2 DRIVERS TABLE
CREATE TABLE IF NOT EXISTS public.drivers (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL
);

-- 2.3 BANKS TABLE
CREATE TABLE IF NOT EXISTS public.banks (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL
);

-- 2.4 DRIVER SUMMARIES TABLE
CREATE TABLE IF NOT EXISTS public.driver_summaries (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  driver_name text NOT NULL,
  date text NOT NULL,
  total_bill_count real NOT NULL DEFAULT 0,
  total_amount real NOT NULL DEFAULT 0,
  cash_breakdown jsonb
);

-- 2.5 SETTINGS TABLE
CREATE TABLE IF NOT EXISTS public.settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

-- 2.6 CONTACTS TABLE
CREATE TABLE IF NOT EXISTS public.contacts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  type text NOT NULL,
  name text NOT NULL,
  mobile text NOT NULL
);

-- Ensure auto-generation of IDs if not provided in CSV imports
DO $$
BEGIN
  ALTER TABLE public.drivers ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
  ALTER TABLE public.banks ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
  ALTER TABLE public.contacts ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
  ALTER TABLE public.driver_summaries ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ==============================================================================
-- 3. INDEXES FOR ULTRA-FAST PERFORMANCE (UP TO 50,000+ BILLS)
-- ==============================================================================
CREATE INDEX IF NOT EXISTS bills_bill_no_idx ON public.bills (bill_no);
CREATE INDEX IF NOT EXISTS bills_driver_idx ON public.bills (driver_name);
CREATE INDEX IF NOT EXISTS bills_delivery_idx ON public.bills (delivery_date);
CREATE INDEX IF NOT EXISTS bills_date_idx ON public.bills (date);
CREATE INDEX IF NOT EXISTS bills_salesperson_idx ON public.bills (salesperson_name);
CREATE INDEX IF NOT EXISTS bills_payment_mode_idx ON public.bills (payment_mode);
CREATE INDEX IF NOT EXISTS bills_party_code_idx ON public.bills (party_code);
CREATE INDEX IF NOT EXISTS bills_payment_date_idx ON public.bills (payment_date);
CREATE INDEX IF NOT EXISTS bills_date_driver_idx ON public.bills (date, driver_name);
CREATE INDEX IF NOT EXISTS bills_delivery_driver_idx ON public.bills (delivery_date, driver_name);
CREATE INDEX IF NOT EXISTS bills_salesperson_date_idx ON public.bills (salesperson_name, date);
CREATE INDEX IF NOT EXISTS contacts_type_idx ON public.contacts (type);

-- ==============================================================================
-- 4. ROW LEVEL SECURITY (RLS) & ACCESS POLICIES
-- ==============================================================================
ALTER TABLE public.bills              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.banks              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_summaries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contacts           ENABLE ROW LEVEL SECURITY;

-- Drop old policies to prevent duplicates on rerun
DROP POLICY IF EXISTS "public read"  ON public.bills;
DROP POLICY IF EXISTS "public write" ON public.bills;
DROP POLICY IF EXISTS "public upd"   ON public.bills;
DROP POLICY IF EXISTS "public del"   ON public.bills;

DROP POLICY IF EXISTS "public read"  ON public.drivers;
DROP POLICY IF EXISTS "public write" ON public.drivers;
DROP POLICY IF EXISTS "public upd"   ON public.drivers;
DROP POLICY IF EXISTS "public del"   ON public.drivers;

DROP POLICY IF EXISTS "public read"  ON public.banks;
DROP POLICY IF EXISTS "public write" ON public.banks;
DROP POLICY IF EXISTS "public upd"   ON public.banks;
DROP POLICY IF EXISTS "public del"   ON public.banks;

DROP POLICY IF EXISTS "public read"  ON public.driver_summaries;
DROP POLICY IF EXISTS "public write" ON public.driver_summaries;
DROP POLICY IF EXISTS "public upd"   ON public.driver_summaries;
DROP POLICY IF EXISTS "public del"   ON public.driver_summaries;

DROP POLICY IF EXISTS "public read"  ON public.settings;
DROP POLICY IF EXISTS "public write" ON public.settings;
DROP POLICY IF EXISTS "public upd"   ON public.settings;
DROP POLICY IF EXISTS "public del"   ON public.settings;

DROP POLICY IF EXISTS "public read"  ON public.contacts;
DROP POLICY IF EXISTS "public write" ON public.contacts;
DROP POLICY IF EXISTS "public upd"   ON public.contacts;
DROP POLICY IF EXISTS "public del"   ON public.contacts;

-- Create Open Policies matching the application architecture
CREATE POLICY "public read"  ON public.bills            FOR SELECT USING (true);
CREATE POLICY "public write" ON public.bills            FOR INSERT WITH CHECK (true);
CREATE POLICY "public upd"   ON public.bills            FOR UPDATE USING (true);
CREATE POLICY "public del"   ON public.bills            FOR DELETE USING (true);

CREATE POLICY "public read"  ON public.drivers          FOR SELECT USING (true);
CREATE POLICY "public write" ON public.drivers          FOR INSERT WITH CHECK (true);
CREATE POLICY "public upd"   ON public.drivers          FOR UPDATE USING (true);
CREATE POLICY "public del"   ON public.drivers          FOR DELETE USING (true);

CREATE POLICY "public read"  ON public.banks            FOR SELECT USING (true);
CREATE POLICY "public write" ON public.banks            FOR INSERT WITH CHECK (true);
CREATE POLICY "public upd"   ON public.banks            FOR UPDATE USING (true);
CREATE POLICY "public del"   ON public.banks            FOR DELETE USING (true);

CREATE POLICY "public read"  ON public.driver_summaries FOR SELECT USING (true);
CREATE POLICY "public write" ON public.driver_summaries FOR INSERT WITH CHECK (true);
CREATE POLICY "public upd"   ON public.driver_summaries FOR UPDATE USING (true);
CREATE POLICY "public del"   ON public.driver_summaries FOR DELETE USING (true);

CREATE POLICY "public read"  ON public.settings         FOR SELECT USING (true);
CREATE POLICY "public write" ON public.settings         FOR INSERT WITH CHECK (true);
CREATE POLICY "public upd"   ON public.settings         FOR UPDATE USING (true);
CREATE POLICY "public del"   ON public.settings         FOR DELETE USING (true);

CREATE POLICY "public read"  ON public.contacts         FOR SELECT USING (true);
CREATE POLICY "public write" ON public.contacts         FOR INSERT WITH CHECK (true);
CREATE POLICY "public upd"   ON public.contacts         FOR UPDATE USING (true);
CREATE POLICY "public del"   ON public.contacts         FOR DELETE USING (true);

-- ==============================================================================
-- 5. REALTIME REPLICATION (CROSS-DEVICE SYNC)
-- ==============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;

ALTER PUBLICATION supabase_realtime ADD TABLE public.bills;
ALTER PUBLICATION supabase_realtime ADD TABLE public.drivers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.banks;
ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_summaries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.settings;
ALTER PUBLICATION supabase_realtime ADD TABLE public.contacts;

-- ==============================================================================
-- 6. DATE PROTECTION TRIGGER (Prevents bill date from accidental overwrite)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.bills_protect_dates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Bill Date: immutable once set (non-empty). Never overwrite with empty/different.
  IF OLD.date IS NOT NULL AND OLD.date <> '' THEN
    NEW.date := OLD.date;
  END IF;
  -- Delivery Date: freely changeable on re-assignment
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_bills_protect_dates ON public.bills;
CREATE TRIGGER trg_bills_protect_dates
BEFORE UPDATE ON public.bills
FOR EACH ROW EXECUTE FUNCTION public.bills_protect_dates();

-- ==============================================================================
-- 7. HELPER FUNCTIONS & RPC PROCEDURES
-- ==============================================================================

-- 7.1 Helper to convert DD/MM/YYYY text into real date
CREATE OR REPLACE FUNCTION public.parse_ddmmyyyy(t text)
RETURNS date
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF t IS NULL OR t = '' THEN RETURN NULL; END IF;
  RETURN to_date(t, 'DD/MM/YYYY');
EXCEPTION WHEN OTHERS THEN
  RETURN NULL;
END;
$$;

-- 7.2 Driver Summary Report RPC
CREATE OR REPLACE FUNCTION public.report_driver_summary(from_date text, to_date text)
RETURNS TABLE (
  driver_name text,
  bill_count bigint,
  total_bill_amt double precision,
  total_collected double precision,
  total_outstanding double precision,
  paid_count bigint,
  fbr_count bigint,
  credit_count bigint,
  del_pending_count bigint,
  unpaid_count bigint
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH f AS (
    SELECT parse_ddmmyyyy(from_date) AS fd, parse_ddmmyyyy(to_date) AS td
  )
  SELECT
    COALESCE(NULLIF(b.driver_name, ''), '(UNASSIGNED)') AS driver_name,
    COUNT(*)::bigint,
    COALESCE(SUM(b.bill_net_amt), 0)::double precision,
    COALESCE(SUM(b.collected_amount), 0)::double precision,
    COALESCE(SUM(b.outstanding_amount), 0)::double precision,
    COUNT(*) FILTER (WHERE b.payment_mode = 'Paid')::bigint,
    COUNT(*) FILTER (WHERE b.payment_mode = 'FBR')::bigint,
    COUNT(*) FILTER (WHERE b.payment_mode = 'Credit')::bigint,
    COUNT(*) FILTER (WHERE b.payment_mode = 'Del Pending')::bigint,
    COUNT(*) FILTER (WHERE b.payment_mode IN ('Unpaid','Assigned') OR b.payment_mode IS NULL)::bigint
  FROM bills b, f
  WHERE parse_ddmmyyyy(b.date) BETWEEN f.fd AND f.td
  GROUP BY 1
  ORDER BY 1;
$$;

-- 7.3 Salesperson Summary Report RPC
CREATE OR REPLACE FUNCTION public.report_salesperson_summary(from_date text, to_date text)
RETURNS TABLE (
  salesperson_name text,
  bill_count bigint,
  total_bill_amt double precision,
  total_collected double precision,
  total_outstanding double precision,
  paid_count bigint,
  fbr_count bigint,
  credit_count bigint,
  del_pending_count bigint,
  unpaid_count bigint
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH f AS (SELECT parse_ddmmyyyy(from_date) AS fd, parse_ddmmyyyy(to_date) AS td)
  SELECT
    COALESCE(NULLIF(b.salesperson_name, ''), '(NONE)'),
    COUNT(*)::bigint,
    COALESCE(SUM(b.bill_net_amt), 0)::double precision,
    COALESCE(SUM(b.collected_amount), 0)::double precision,
    COALESCE(SUM(b.outstanding_amount), 0)::double precision,
    COUNT(*) FILTER (WHERE b.payment_mode = 'Paid')::bigint,
    COUNT(*) FILTER (WHERE b.payment_mode = 'FBR')::bigint,
    COUNT(*) FILTER (WHERE b.payment_mode = 'Credit')::bigint,
    COUNT(*) FILTER (WHERE b.payment_mode = 'Del Pending')::bigint,
    COUNT(*) FILTER (WHERE b.payment_mode IN ('Unpaid','Assigned') OR b.payment_mode IS NULL)::bigint
  FROM bills b, f
  WHERE parse_ddmmyyyy(b.date) BETWEEN f.fd AND f.td
  GROUP BY 1
  ORDER BY 1;
$$;

-- 7.4 Payment Mode Summary Report RPC
CREATE OR REPLACE FUNCTION public.report_payment_mode_summary(from_date text, to_date text)
RETURNS TABLE (
  status text,
  bill_count bigint,
  total_bill_amt double precision,
  total_collected double precision,
  total_outstanding double precision
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH f AS (SELECT parse_ddmmyyyy(from_date) AS fd, parse_ddmmyyyy(to_date) AS td)
  SELECT
    COALESCE(NULLIF(b.payment_mode, ''), 'Unpaid') AS status,
    COUNT(*)::bigint,
    COALESCE(SUM(b.bill_net_amt), 0)::double precision,
    COALESCE(SUM(b.collected_amount), 0)::double precision,
    COALESCE(SUM(b.outstanding_amount), 0)::double precision
  FROM bills b, f
  WHERE parse_ddmmyyyy(b.date) BETWEEN f.fd AND f.td
  GROUP BY 1
  ORDER BY 2 DESC;
$$;

-- 7.5 List Bills Since (N Days Back) RPC
CREATE OR REPLACE FUNCTION public.list_bills_since(days_back int)
RETURNS SETOF public.bills
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT *
  FROM public.bills
  WHERE parse_ddmmyyyy(date) >= (current_date - make_interval(days => days_back))
     OR parse_ddmmyyyy(date) IS NULL;
$$;

GRANT EXECUTE ON FUNCTION public.parse_ddmmyyyy(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_driver_summary(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_salesperson_summary(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_payment_mode_summary(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.list_bills_since(int) TO anon, authenticated, service_role;
