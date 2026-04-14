-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Daily logs table
create table daily_logs (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null,
  sleep_duration numeric,
  sleep_awake_pct numeric,
  sleep_restorative numeric,
  sleep_efficiency numeric,
  recovery_score numeric,
  hrv numeric,
  rhr numeric,
  calories integer,
  water integer,
  steps integer,
  weight numeric,
  activity text[] default '{}',
  habits text[] default '{}',
  supplements text[] default '{}',
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(user_id, date)
);

-- Goals table
create table goals (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  category text not null,
  target_value numeric not null,
  timeframe text not null check (timeframe in ('day','week','month','quarter','year')),
  effective_from date not null default current_date,
  created_at timestamptz default now()
);

-- Settings table (calorie target, weight goal etc)
create table user_settings (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null unique,
  calorie_target integer default 1900,
  water_target integer default 2500,
  steps_target integer default 10000,
  target_weight numeric,
  start_weight numeric,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Recipes table
create table recipes (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  description text,
  calories integer,
  protein numeric,
  carbs numeric,
  fat numeric,
  servings integer default 1,
  prep_time integer,
  instructions text,
  created_at timestamptz default now()
);

-- Meal preps table
create table meal_preps (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  cook_date date not null,
  total_calories integer,
  total_portions integer,
  portions_remaining integer,
  notes text,
  created_at timestamptz default now()
);

-- Meal prep portions
create table meal_prep_portions (
  id uuid default uuid_generate_v4() primary key,
  meal_prep_id uuid references meal_preps(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  portion_number integer not null,
  calories integer,
  used boolean default false,
  used_date date,
  created_at timestamptz default now()
);

-- Meal log (individual meals logged per day)
create table meal_logs (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null,
  meal_name text not null,
  meal_type text,
  calories integer,
  protein numeric,
  carbs numeric,
  fat numeric,
  source text default 'ai_photo',
  logged_at timestamptz default now()
);

-- Progress photos metadata (actual images stored in Supabase Storage)
create table progress_photos (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  photo_date date not null,
  photo_type text not null check (photo_type in ('face','upper_body')),
  storage_path text not null,
  weight_at_time numeric,
  ai_observation text,
  created_at timestamptz default now()
);

-- Row Level Security - users can only see their own data
alter table daily_logs enable row level security;
alter table goals enable row level security;
alter table user_settings enable row level security;
alter table recipes enable row level security;
alter table meal_preps enable row level security;
alter table meal_prep_portions enable row level security;
alter table meal_logs enable row level security;
alter table progress_photos enable row level security;

-- RLS Policies
create policy "Users own their daily logs" on daily_logs for all using (auth.uid() = user_id);
create policy "Users own their goals" on goals for all using (auth.uid() = user_id);
create policy "Users own their settings" on user_settings for all using (auth.uid() = user_id);
create policy "Users own their recipes" on recipes for all using (auth.uid() = user_id);
create policy "Users own their meal preps" on meal_preps for all using (auth.uid() = user_id);
create policy "Users own their portions" on meal_prep_portions for all using (auth.uid() = user_id);
create policy "Users own their meal logs" on meal_logs for all using (auth.uid() = user_id);
create policy "Users own their photos" on progress_photos for all using (auth.uid() = user_id);

-- Storage bucket for progress photos (run separately in storage settings)
-- Create a private bucket called 'progress-photos'
