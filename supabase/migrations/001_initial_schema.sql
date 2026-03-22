-- Enable UUID extension
create extension if not exists "pgcrypto";

-- ─── merchants ───────────────────────────────────────────────────────────────
drop trigger if exists merchants_updated_at on merchants;

create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists merchants (
  id              uuid primary key default gen_random_uuid(),
  canonical_name  text not null,
  category        text not null default 'unknown'
                    check (category in ('food', 'transport', 'unknown')),
  payment_method  text not null default 'unknown'
                    check (payment_method in ('qr', 'card', 'unknown')),
  approved_count  integer not null default 0,
  flagged_count   integer not null default 0,
  auto_classify   boolean not null default false,
  aliases         text[] not null default '{}',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger merchants_updated_at
  before update on merchants
  for each row execute function update_updated_at();

-- ─── reports ─────────────────────────────────────────────────────────────────
create table if not exists reports (
  id            uuid primary key default gen_random_uuid(),
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'draft'
                  check (status in ('draft', 'pending', 'approved')),
  token         uuid not null default gen_random_uuid(),
  created_at    timestamptz not null default now(),
  constraint reports_period_check check (period_end >= period_start)
);

create unique index if not exists reports_token_idx on reports (token);

-- ─── expenses ────────────────────────────────────────────────────────────────
create table if not exists expenses (
  id              uuid primary key default gen_random_uuid(),
  report_id       uuid not null references reports (id) on delete cascade,
  date            date not null,
  amount          numeric(12, 2) not null,
  currency        text not null default 'THB',
  category        text not null default 'unknown'
                    check (category in ('food', 'transport', 'unknown')),
  merchant_id     uuid references merchants (id) on delete set null,
  payment_method  text not null default 'unknown'
                    check (payment_method in ('qr', 'card', 'unknown')),
  auto_classified boolean not null default false,
  needs_review    boolean not null default true,
  status          text not null default 'pending'
                    check (status in ('pending', 'confirmed', 'flagged')),
  created_at      timestamptz not null default now()
);

create index if not exists expenses_report_id_idx  on expenses (report_id);
create index if not exists expenses_merchant_id_idx on expenses (merchant_id);

-- ─── ocr_raw ─────────────────────────────────────────────────────────────────
create table if not exists ocr_raw (
  id                   uuid primary key default gen_random_uuid(),
  expense_id           uuid not null references expenses (id) on delete cascade,
  raw_json             jsonb not null default '{}',
  confidence_scores    jsonb not null default '{}',
  raw_merchant_string  text
);

create unique index if not exists ocr_raw_expense_id_idx on ocr_raw (expense_id);

-- ─── Row Level Security ───────────────────────────────────────────────────────
alter table merchants enable row level security;
alter table reports   enable row level security;
alter table expenses  enable row level security;
alter table ocr_raw   enable row level security;

drop policy if exists "anon_all_merchants" on merchants;
drop policy if exists "anon_all_reports"   on reports;
drop policy if exists "anon_all_expenses"  on expenses;
drop policy if exists "anon_all_ocr_raw"   on ocr_raw;

create policy "anon_all_merchants" on merchants for all to anon using (true) with check (true);
create policy "anon_all_reports"   on reports   for all to anon using (true) with check (true);
create policy "anon_all_expenses"  on expenses  for all to anon using (true) with check (true);
create policy "anon_all_ocr_raw"   on ocr_raw   for all to anon using (true) with check (true);

-- ─── Storage bucket ──────────────────────────────────────────────────────────
-- Create manually in Supabase dashboard:
--   Storage → New bucket → name: receipts → private
-- Path convention: receipts/expenses/<expense_id>
