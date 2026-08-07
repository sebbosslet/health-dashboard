-- ============================================================
-- Tax bookkeeping ledger. Every uploaded document becomes one or more
-- dated ledger entries (income/expense), categorised LLC vs W-2.
-- ============================================================

-- Per-user settings (EOY assumptions etc.)
create table if not exists tax_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  doc        jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table tax_state enable row level security;
drop policy if exists "Users own their tax state" on tax_state;
create policy "Users own their tax state" on tax_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Uploaded source files (the evidence behind entries)
create table if not exists tax_documents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  file_name   text not null,
  mime_type   text,
  size_bytes  bigint,
  doc_kind    text,                          -- payslip | w2 | 1099 | 1095c | receipt | invoice | other
  tax_year    int not null default extract(year from now()),
  uploaded_at timestamptz not null default now()
);
alter table tax_documents enable row level security;
drop policy if exists "Owner manages own tax documents" on tax_documents;
create policy "Owner manages own tax documents" on tax_documents
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- Advisor may read source files EXCEPT payslips
drop policy if exists "Advisor reads non-payslip docs" on tax_documents;
create policy "Advisor reads non-payslip docs" on tax_documents
  for select using (
    auth.uid() = 'ADVISOR_UID_HERE' and doc_kind is distinct from 'payslip'
  );

-- The ledger itself
create table if not exists tax_entries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  entry_date   date not null,
  book         text not null default 'llc' check (book in ('llc','w2')),
  direction    text not null default 'expense' check (direction in ('income','expense')),
  category     text,
  vendor       text,
  amount       numeric(14,2) not null default 0,   -- always positive; direction carries the sign
  note         text,
  -- payroll extras, only on W-2 income lines, for the refund projection
  fed_withheld numeric(14,2),
  state_withheld numeric(14,2),
  pretax       numeric(14,2),
  periods_per_year int,
  source_doc   uuid references tax_documents(id) on delete set null,
  needs_review boolean not null default false,
  tax_year     int not null default extract(year from now()),
  created_at   timestamptz not null default now()
);
alter table tax_entries enable row level security;
drop policy if exists "Owner manages own tax entries" on tax_entries;
create policy "Owner manages own tax entries" on tax_entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- Advisor reads LLC lines (income + expenses) and W-2 INCOME, never
-- the per-check withholding detail is hidden at the app layer.
drop policy if exists "Advisor reads llc and w2 income" on tax_entries;
create policy "Advisor reads llc and w2 income" on tax_entries
  for select using (
    auth.uid() = 'ADVISOR_UID_HERE' and (book = 'llc' or direction = 'income')
  );

create index if not exists idx_tax_entries on tax_entries (user_id, tax_year, book, entry_date);
