-- sebs.cashflow — state storage
-- One document per user. Relational transaction tables follow with Plaid.

create table if not exists cashflow_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  doc        jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table cashflow_state enable row level security;

drop policy if exists "Users own their cashflow state" on cashflow_state;
create policy "Users own their cashflow state"
  on cashflow_state for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
