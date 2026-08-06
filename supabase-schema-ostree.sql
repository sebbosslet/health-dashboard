-- Opportunity Solution Tree — status markup, one jsonb doc per user
create table if not exists ostree_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  doc        jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table ostree_state enable row level security;
drop policy if exists "Users own their ostree" on ostree_state;
create policy "Users own their ostree" on ostree_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
