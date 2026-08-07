-- ============================================================
-- Tax tracker — documents, categorized LLC vs Employment,
-- plus a manual figures store for the projection.
-- ============================================================

-- 1. Per-user tax settings + manual figures (one jsonb doc)
create table if not exists tax_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  doc        jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table tax_state enable row level security;
drop policy if exists "Users own their tax state" on tax_state;
create policy "Users own their tax state" on tax_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- 2. Uploaded documents (metadata; the file itself lives in Storage)
create table if not exists tax_documents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  file_name   text not null,
  mime_type   text,
  size_bytes  bigint,
  category    text not null default 'llc' check (category in ('llc','employment')),
  doc_type    text,                         -- payslip | w2 | 1095c | receipt | 1099 | other
  year_end    boolean not null default false, -- year-end doc the advisor should see
  tax_year    int not null default extract(year from now()),
  note        text,
  uploaded_at timestamptz not null default now()
);
alter table tax_documents enable row level security;

-- Owner sees everything of theirs
drop policy if exists "Owner manages own tax documents" on tax_documents;
create policy "Owner manages own tax documents" on tax_documents
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- The advisor (a specific uid, set below) may READ only LLC docs and
-- year-end documents — never ongoing payslips / employment items.
-- Replace the advisor uid after you create that account, then re-run this policy.
drop policy if exists "Advisor reads llc and year-end docs" on tax_documents;
create policy "Advisor reads llc and year-end docs" on tax_documents
  for select using (
    auth.uid() = 'ADVISOR_UID_HERE'
    and (category = 'llc' or year_end = true)
    and doc_type is distinct from 'payslip'
  );

create index if not exists idx_tax_docs_user on tax_documents (user_id, tax_year, category);
