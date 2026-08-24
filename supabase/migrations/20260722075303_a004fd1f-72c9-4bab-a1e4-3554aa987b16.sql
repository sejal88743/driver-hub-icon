
-- All bill dates are stored as DD/MM/YYYY text. Helper converts to real date for
-- range comparison; returns NULL on unparseable input so those rows are ignored.
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

-- ─── Driver summary ────────────────────────────────────────────────────────
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

-- ─── Salesperson summary ───────────────────────────────────────────────────
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

-- ─── Payment mode summary ──────────────────────────────────────────────────
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
    CASE
      WHEN b.payment_mode IS NULL OR b.payment_mode IN ('Unpaid','Assigned') THEN 'Unpaid'
      ELSE b.payment_mode
    END AS status,
    COUNT(*)::bigint,
    COALESCE(SUM(b.bill_net_amt),0)::double precision,
    COALESCE(SUM(b.collected_amount),0)::double precision,
    COALESCE(SUM(b.outstanding_amount),0)::double precision
  FROM bills b, f
  WHERE parse_ddmmyyyy(b.date) BETWEEN f.fd AND f.td
  GROUP BY 1
  ORDER BY 1;
$$;

-- ─── Daily collection (cash / upi / cheque) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.report_daily_collection(from_date text, to_date text)
RETURNS TABLE (
  collection_date text,
  bill_count bigint,
  cash_amount double precision,
  upi_amount double precision,
  cheque_amount double precision,
  total_collected double precision
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  WITH f AS (SELECT parse_ddmmyyyy(from_date) AS fd, parse_ddmmyyyy(to_date) AS td)
  SELECT
    b.payment_date,
    COUNT(*)::bigint,
    COALESCE(SUM(b.cash_amount),0)::double precision,
    COALESCE(SUM(b.upi_amount),0)::double precision,
    COALESCE(SUM(b.cheque_amount),0)::double precision,
    COALESCE(SUM(b.collected_amount),0)::double precision
  FROM bills b, f
  WHERE b.payment_date IS NOT NULL AND b.payment_date <> ''
    AND parse_ddmmyyyy(b.payment_date) BETWEEN f.fd AND f.td
  GROUP BY b.payment_date
  ORDER BY parse_ddmmyyyy(b.payment_date);
$$;

-- ─── Party outstanding (top N) ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.report_party_outstanding(limit_n int DEFAULT 200)
RETURNS TABLE (
  party_code text,
  party_name text,
  bill_count bigint,
  total_outstanding double precision
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT
    b.party_code,
    MAX(b.party_name),
    COUNT(*)::bigint,
    COALESCE(SUM(b.outstanding_amount),0)::double precision
  FROM bills b
  WHERE COALESCE(b.outstanding_amount,0) > 0
  GROUP BY b.party_code
  ORDER BY 4 DESC
  LIMIT limit_n;
$$;

-- ─── Dashboard counts for one driver on one delivery date ──────────────────
CREATE OR REPLACE FUNCTION public.dashboard_counts(target_date text, driver text)
RETURNS TABLE (
  load_count bigint,
  done_count bigint,
  pend_count bigint,
  total_amt double precision,
  collected_amt double precision
)
LANGUAGE sql STABLE
SET search_path = public
AS $$
  SELECT
    COUNT(*)::bigint AS load_count,
    COUNT(*) FILTER (
      WHERE b.payment_date = target_date
        AND b.payment_mode IN ('Paid','FBR','Credit')
    )::bigint AS done_count,
    COUNT(*) FILTER (
      WHERE NOT (b.payment_date = target_date AND b.payment_mode IN ('Paid','FBR','Credit'))
    )::bigint AS pend_count,
    COALESCE(SUM(b.bill_net_amt),0)::double precision,
    COALESCE(SUM(b.collected_amount),0)::double precision
  FROM bills b
  WHERE b.delivery_date = target_date
    AND b.driver_name = driver;
$$;

-- Grants (anon + authenticated match existing table policy which is public)
GRANT EXECUTE ON FUNCTION public.parse_ddmmyyyy(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_driver_summary(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_salesperson_summary(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_payment_mode_summary(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_daily_collection(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.report_party_outstanding(int) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.dashboard_counts(text, text) TO anon, authenticated, service_role;
