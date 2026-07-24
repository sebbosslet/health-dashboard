-- sebs.cashflow EUR — state storage
-- The euro account connects through the same Plaid integration as USD,
-- so no separate aggregator tables are needed.

create table if not exists eurflow_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  doc        jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table eurflow_state enable row level security;
drop policy if exists "Users own their eurflow state" on eurflow_state;
create policy "Users own their eurflow state" on eurflow_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Plaid accounts gain a currency so euro accounts can be told apart.
alter table plaid_accounts add column if not exists currency text default 'USD';
