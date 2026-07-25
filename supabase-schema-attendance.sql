-- Office attendance tracker — one document per user (date → day-type map)
create table if not exists attendance_state (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  doc        jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table attendance_state enable row level security;
drop policy if exists "Users own their attendance" on attendance_state;
create policy "Users own their attendance" on attendance_state
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
