-- WHOOP integration tokens
create table if not exists whoop_tokens (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null unique,
  access_token text not null,
  refresh_token text not null,
  expires_at timestamptz not null,
  whoop_user_id text,
  last_synced_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table whoop_tokens enable row level security;
create policy "Users own their WHOOP tokens" on whoop_tokens for all using (auth.uid() = user_id);

-- Apple Health sync log (tracks last sync so Shortcut knows what to send)
create table if not exists apple_health_sync (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null unique,
  last_weight_sync timestamptz,
  last_steps_sync timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table apple_health_sync enable row level security;
create policy "Users own their Apple Health sync" on apple_health_sync for all using (auth.uid() = user_id);

-- Add sync_token column to user_settings for Apple Health Shortcut authentication
alter table user_settings add column if not exists shortcut_token text;
