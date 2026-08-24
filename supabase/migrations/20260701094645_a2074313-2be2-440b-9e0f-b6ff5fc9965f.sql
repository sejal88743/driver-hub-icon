
CREATE OR REPLACE FUNCTION public.bills_protect_dates()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.date IS NOT NULL AND OLD.date <> '' THEN
    NEW.date := OLD.date;
  END IF;
  IF OLD.delivery_date IS NOT NULL AND OLD.delivery_date <> '' THEN
    IF NEW.delivery_date IS NOT NULL AND NEW.delivery_date <> '' AND NEW.delivery_date <> OLD.delivery_date THEN
      NEW.delivery_date := OLD.delivery_date;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bills_protect_dates ON public.bills;
CREATE TRIGGER trg_bills_protect_dates
BEFORE UPDATE ON public.bills
FOR EACH ROW EXECUTE FUNCTION public.bills_protect_dates();
