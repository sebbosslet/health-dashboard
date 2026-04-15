-- Special events / context entries
create table if not exists daily_events (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null,
  event_type text not null, -- 'travel' | 'stress' | 'work' | 'social' | 'health' | 'custom'
  label text not null,       -- short display label e.g. "Flew to CET", "Big presentation"
  detail text,               -- optional longer note
  -- Travel-specific
  timezone_from text,        -- e.g. 'ET'
  timezone_to text,          -- e.g. 'CET'
  timezone_offset int,       -- hours difference e.g. 6
  travel_active boolean default false, -- true while still in that timezone
  created_at timestamptz default now()
);

alter table daily_events enable row level security;
create policy "Users own their events" on daily_events for all using (auth.uid() = user_id);

-- Active travel state (persists across days)
create table if not exists travel_state (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null unique,
  timezone_from text,
  timezone_to text,
  timezone_offset int,
  departure_date date,
  label text,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table travel_state enable row level security;
create policy "Users own their travel state" on travel_state for all using (auth.uid() = user_id);
