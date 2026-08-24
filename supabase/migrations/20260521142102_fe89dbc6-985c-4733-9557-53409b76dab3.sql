
-- VitraTrack schema port (matches original Drizzle schema)
create table public.bills (
  id text primary key,
  sr_no text not null default '',
  date text not null default '',
  salesperson_name text not null default '',
  collection_code text not null default '',
  bill_no text not null default '',
  party_code text not null default '',
  party_hul_code text not null default '',
  party_name text not null default '',
  beat_name text not null default '',
  bill_net_amt real not null default 0,
  collected_amount real not null default 0,
  outstanding_amount real not null default 0,
  bill_ageing real not null default 0,
  payment_mode text,
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
  cash_amount real,
  upi_amount real,
  cheque_amount real,
  updated_at timestamptz default now()
);
create index bills_bill_no_idx on public.bills (bill_no);
create index bills_driver_idx on public.bills (driver_name);
create index bills_delivery_idx on public.bills (delivery_date);

create table public.drivers (
  id text primary key,
  name text not null
);

create table public.banks (
  id text primary key,
  name text not null
);

create table public.driver_summaries (
  id text primary key,
  driver_name text not null,
  date text not null,
  total_bill_count real not null default 0,
  total_amount real not null default 0,
  cash_breakdown jsonb
);

create table public.settings (
  key text primary key,
  value text not null
);

create table public.contacts (
  id text primary key,
  type text not null,
  name text not null,
  mobile text not null
);
create index contacts_type_idx on public.contacts (type);

alter table public.bills              enable row level security;
alter table public.drivers            enable row level security;
alter table public.banks              enable row level security;
alter table public.driver_summaries   enable row level security;
alter table public.settings           enable row level security;
alter table public.contacts           enable row level security;

-- Single-tenant internal tool: original had no auth; app-level password gates writes.
-- Open read/write policies to mirror original Express API behavior.
create policy "public read"  on public.bills            for select using (true);
create policy "public write" on public.bills            for insert with check (true);
create policy "public upd"   on public.bills            for update using (true);
create policy "public del"   on public.bills            for delete using (true);

create policy "public read"  on public.drivers          for select using (true);
create policy "public write" on public.drivers          for insert with check (true);
create policy "public upd"   on public.drivers          for update using (true);
create policy "public del"   on public.drivers          for delete using (true);

create policy "public read"  on public.banks            for select using (true);
create policy "public write" on public.banks            for insert with check (true);
create policy "public upd"   on public.banks            for update using (true);
create policy "public del"   on public.banks            for delete using (true);

create policy "public read"  on public.driver_summaries for select using (true);
create policy "public write" on public.driver_summaries for insert with check (true);
create policy "public upd"   on public.driver_summaries for update using (true);
create policy "public del"   on public.driver_summaries for delete using (true);

create policy "public read"  on public.settings         for select using (true);
create policy "public write" on public.settings         for insert with check (true);
create policy "public upd"   on public.settings         for update using (true);
create policy "public del"   on public.settings         for delete using (true);

create policy "public read"  on public.contacts         for select using (true);
create policy "public write" on public.contacts         for insert with check (true);
create policy "public upd"   on public.contacts         for update using (true);
create policy "public del"   on public.contacts         for delete using (true);

-- Enable realtime for cross-device live sync
alter publication supabase_realtime add table public.bills;
alter publication supabase_realtime add table public.drivers;
alter publication supabase_realtime add table public.banks;
alter publication supabase_realtime add table public.driver_summaries;
alter publication supabase_realtime add table public.settings;
alter publication supabase_realtime add table public.contacts;
