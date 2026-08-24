CREATE OR REPLACE FUNCTION public.bills_protect_dates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Bill Date: immutable once set (non-empty). Never overwrite.
  IF OLD.date IS NOT NULL AND OLD.date <> '' THEN
    NEW.date := OLD.date;
  END IF;
  -- Delivery Date: now FREELY changeable so re-assignment updates the DEL DATE.
  RETURN NEW;
END;
$function$;