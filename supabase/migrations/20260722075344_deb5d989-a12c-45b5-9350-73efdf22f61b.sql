
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

GRANT EXECUTE ON FUNCTION public.list_bills_since(int) TO anon, authenticated, service_role;
