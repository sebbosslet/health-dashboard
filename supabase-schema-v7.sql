-- Medications table (time-critical, prescribed)
create table if not exists medications (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  dose text,                    -- e.g. "100mcg", "500mg"
  scheduled_time time,          -- e.g. 07:00
  instructions text,            -- e.g. "Take fasted, 30min before food"
  active boolean default true,
  sort_order int default 0,
  created_at timestamptz default now()
);

alter table medications enable row level security;
create policy "Users own their medications" on medications for all using (auth.uid() = user_id);

-- Supplements table (wellness, flexible timing)
create table if not exists supplements (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  dose text,                    -- e.g. "400mg", "1 capsule"
  scheduled_time time,          -- optional preferred time
  with_food boolean default false,
  active boolean default true,
  sort_order int default 0,
  created_at timestamptz default now()
);

alter table supplements enable row level security;
create policy "Users own their supplements" on supplements for all using (auth.uid() = user_id);

-- Daily medication logs (tracks when taken + actual time)
create table if not exists medication_logs (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  medication_id uuid references medications(id) on delete cascade not null,
  date date not null,
  taken boolean default false,
  taken_time time,              -- actual time taken (vs scheduled)
  fasted boolean,               -- was it taken fasted?
  note text,
  created_at timestamptz default now(),
  unique(medication_id, date)
);

alter table medication_logs enable row level security;
create policy "Users own their medication logs" on medication_logs for all using (auth.uid() = user_id);

-- Daily supplement logs
create table if not exists supplement_logs (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  supplement_id uuid references supplements(id) on delete cascade not null,
  date date not null,
  taken boolean default false,
  taken_time time,
  note text,
  created_at timestamptz default now(),
  unique(supplement_id, date)
);

alter table supplement_logs enable row level security;
create policy "Users own their supplement logs" on supplement_logs for all using (auth.uid() = user_id);
