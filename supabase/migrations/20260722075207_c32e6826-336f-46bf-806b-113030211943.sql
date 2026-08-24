
CREATE INDEX IF NOT EXISTS bills_date_idx ON public.bills (date);
CREATE INDEX IF NOT EXISTS bills_salesperson_idx ON public.bills (salesperson_name);
CREATE INDEX IF NOT EXISTS bills_payment_mode_idx ON public.bills (payment_mode);
CREATE INDEX IF NOT EXISTS bills_party_code_idx ON public.bills (party_code);
CREATE INDEX IF NOT EXISTS bills_payment_date_idx ON public.bills (payment_date);
CREATE INDEX IF NOT EXISTS bills_date_driver_idx ON public.bills (date, driver_name);
CREATE INDEX IF NOT EXISTS bills_delivery_driver_idx ON public.bills (delivery_date, driver_name);
CREATE INDEX IF NOT EXISTS bills_salesperson_date_idx ON public.bills (salesperson_name, date);
