-- sebs.cashflow EUR — state storage and GoCardless (Bank Account Data) connections

create table if not exists eurflow_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  doc        jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table eurflow_state enable row level security;
drop policy if exists "Users own their eurflow state" on eurflow_state;
create policy "Users own their eurflow state" on eurflow_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- GoCardless requisitions. Like Plaid items, these stay server-side only.
create table if not exists gocardless_requisitions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  requisition_id text not null unique,
  institution_id text,
  institution    text,
  status         text not null default 'pending',
  reference      text,
  created_at     timestamptz not null default now()
);

create table if not exists gocardless_accounts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  requisition_id text not null,
  account_id     text not null unique,
  iban           text,
  name           text,
  currency       text,
  balance        numeric(14,2),
  balance_as_of  timestamptz,
  use_as_anchor  boolean not null default false,
  created_at     timestamptz not null default now()
);

create table if not exists gocardless_transactions (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users(id) on delete cascade,
  account_id     text not null,
  transaction_id text not null unique,
  date           date not null,
  amount         numeric(14,2) not null,   -- signed: negative = money out
  currency       text,
  description    text,
  counterparty   text,
  pending        boolean not null default false,
  created_at     timestamptz not null default now()
);

create index if not exists idx_gc_tx_user_date on gocardless_transactions (user_id, date desc);

alter table gocardless_requisitions enable row level security;
alter table gocardless_accounts     enable row level security;
alter table gocardless_transactions enable row level security;

-- requisitions: no policy, service key only
drop policy if exists "Users read their gocardless accounts" on gocardless_accounts;
create policy "Users read their gocardless accounts" on gocardless_accounts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "Users read their gocardless transactions" on gocardless_transactions;
create policy "Users read their gocardless transactions" on gocardless_transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
