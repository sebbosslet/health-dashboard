-- sebs.health — full current schema (canonical reference)
-- Run this on a fresh Supabase project to recreate everything
-- For existing projects: only run the ALTER TABLE sections for missing columns

-- ─── Extensions ──────────────────────────────────────────────────────────────
create extension if not exists "uuid-ossp";

-- ─── daily_logs ──────────────────────────────────────────────────────────────
create table if not exists daily_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null,
  date date not null,
  -- WHOOP sync
  recovery_score int,
  sleep_duration numeric,
  sleep_efficiency numeric,
  sleep_restorative numeric,
  hrv numeric,
  rhr int,
  steps int,
  -- Nutrition
  calories int,
  water int,
  weight numeric,
  -- Activity & habits
  activity text[],
  habits text[],
  -- Morning check-in
  morning_energy int,
  morning_mood int,
  morning_soreness int,
  morning_note text,
  -- Evening log
  phone_away_time time,
  bed_time time,
  wind_down text,
  evening_note text,
  dinner_time time,
  ac_temp numeric,
  eye_bags boolean default false,
  -- AI outputs
  ai_insight text,
  ai_insight_date date,
  ai_briefing text,
  ai_weekly_sleep_report text,
  -- Meta
  updated_at timestamptz default now(),
  unique (user_id, date)
);

alter table daily_logs enable row level security;
create policy "Users own their logs" on daily_logs for all using (auth.uid() = user_id);

-- ─── meal_logs ───────────────────────────────────────────────────────────────
create table if not exists meal_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null,
  date date not null,
  meal_name text not null,
  meal_type text,
  calories int,
  protein numeric,
  carbs numeric,
  fat numeric,
  source text default 'photo',
  consumed_at time,
  is_caffeinated boolean default false,
  created_at timestamptz default now()
);

alter table meal_logs enable row level security;
create policy "Users own their meals" on meal_logs for all using (auth.uid() = user_id);

-- ─── medications ─────────────────────────────────────────────────────────────
create table if not exists medications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null,
  name text not null,
  dose text,
  instructions text,
  fasted_flag boolean default false,
  active boolean default true,
  created_at timestamptz default now()
);

alter table medications enable row level security;
create policy "Users own their medications" on medications for all using (auth.uid() = user_id);

-- ─── medication_logs ─────────────────────────────────────────────────────────
create table if not exists medication_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null,
  date date not null,
  medication_id uuid references medications on delete cascade not null,
  taken boolean default false,
  taken_time time,
  created_at timestamptz default now()
);

alter table medication_logs enable row level security;
create policy "Users own their medication logs" on medication_logs for all using (auth.uid() = user_id);

-- ─── supplements ─────────────────────────────────────────────────────────────
create table if not exists supplements (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null,
  name text not null,
  dose text,
  with_food boolean default false,
  active boolean default true,
  created_at timestamptz default now()
);

alter table supplements enable row level security;
create policy "Users own their supplements" on supplements for all using (auth.uid() = user_id);

-- ─── supplement_logs ─────────────────────────────────────────────────────────
create table if not exists supplement_logs (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null,
  date date not null,
  supplement_id uuid references supplements on delete cascade not null,
  taken boolean default false,
  taken_time time,
  created_at timestamptz default now()
);

alter table supplement_logs enable row level security;
create policy "Users own their supplement logs" on supplement_logs for all using (auth.uid() = user_id);

-- ─── goals ───────────────────────────────────────────────────────────────────
create table if not exists goals (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null,
  name text not null,
  type text,
  target_value numeric,
  unit text,
  timeframe text,
  active boolean default true,
  created_at timestamptz default now()
);

alter table goals enable row level security;
create policy "Users own their goals" on goals for all using (auth.uid() = user_id);

-- ─── user_settings ───────────────────────────────────────────────────────────
create table if not exists user_settings (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null unique,
  calorie_target int default 1900,
  water_target int default 2500,
  steps_target int default 10000,
  start_weight numeric,
  target_weight numeric,
  shortcut_token text,
  updated_at timestamptz default now()
);

alter table user_settings enable row level security;
create policy "Users own their settings" on user_settings for all using (auth.uid() = user_id);

-- ─── whoop_tokens ────────────────────────────────────────────────────────────
create table if not exists whoop_tokens (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null unique,
  access_token text,
  refresh_token text,
  expires_at timestamptz,
  updated_at timestamptz default now()
);

alter table whoop_tokens enable row level security;
create policy "Users own their tokens" on whoop_tokens for all using (auth.uid() = user_id);

-- ─── apple_health_sync ───────────────────────────────────────────────────────
create table if not exists apple_health_sync (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null,
  date date not null,
  steps int,
  weight numeric,
  synced_at timestamptz default now(),
  unique (user_id, date)
);

alter table apple_health_sync enable row level security;
create policy "Users own their health sync" on apple_health_sync for all using (auth.uid() = user_id);

-- ─── progress_photos ─────────────────────────────────────────────────────────
create table if not exists progress_photos (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null,
  photo_date date not null,
  type text,
  storage_path text,
  notes text,
  created_at timestamptz default now()
);

alter table progress_photos enable row level security;
create policy "Users own their photos" on progress_photos for all using (auth.uid() = user_id);

-- ─── sleep_hr_analysis ───────────────────────────────────────────────────────
create table if not exists sleep_hr_analysis (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null,
  date date not null,
  -- Sleep summary (extracted from WHOOP screenshot)
  sleep_onset time,
  wake_time time,
  sleep_duration_h numeric,
  awake_pct numeric,
  light_pct numeric,
  deep_pct numeric,
  rem_pct numeric,
  -- HR metrics (if HR graph uploaded)
  hr_baseline numeric,
  hr_min numeric,
  hr_max numeric,
  hr_range numeric,
  axis_min numeric,
  axis_max numeric,
  spike_count int,
  spike_avg_magnitude numeric,
  spike_max_magnitude numeric,
  stable_pct numeric,
  fragmented_pct numeric,
  stability_score numeric,
  -- Analysis
  likely_cause text,
  cause_confidence text,
  cause_reasoning text,
  micro_arousals_likely boolean,
  micro_arousal_count int,
  analysis text,
  eye_bag_risk text,
  recommendation text,
  -- Context at time of upload
  eye_bag_flag boolean,
  dinner_time time,
  ac_temp numeric,
  screenshot_path text,
  created_at timestamptz default now(),
  unique (user_id, date)
);

alter table sleep_hr_analysis enable row level security;
create policy "Users own their sleep HR analysis" on sleep_hr_analysis for all using (auth.uid() = user_id);

-- ─── daily_events ────────────────────────────────────────────────────────────
create table if not exists daily_events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null,
  date date not null,
  label text not null,
  notes text,
  created_at timestamptz default now()
);

alter table daily_events enable row level security;
create policy "Users own their events" on daily_events for all using (auth.uid() = user_id);

-- ─── travel_state ────────────────────────────────────────────────────────────
create table if not exists travel_state (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null,
  active boolean default false,
  label text,
  timezone_from text,
  timezone_to text,
  timezone_offset int,
  departure_date date,
  created_at timestamptz default now()
);

alter table travel_state enable row level security;
create policy "Users own their travel state" on travel_state for all using (auth.uid() = user_id);

-- ─── recipes ─────────────────────────────────────────────────────────────────
create table if not exists recipes (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null,
  name text not null,
  ingredients text[],
  instructions text,
  calories_per_serving int,
  protein_per_serving numeric,
  carbs_per_serving numeric,
  fat_per_serving numeric,
  servings int default 1,
  created_at timestamptz default now()
);

alter table recipes enable row level security;
create policy "Users own their recipes" on recipes for all using (auth.uid() = user_id);

-- ─── meal_preps ──────────────────────────────────────────────────────────────
create table if not exists meal_preps (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null,
  recipe_id uuid references recipes on delete cascade,
  prep_date date not null,
  total_servings int,
  notes text,
  created_at timestamptz default now()
);

alter table meal_preps enable row level security;
create policy "Users own their meal preps" on meal_preps for all using (auth.uid() = user_id);

-- ─── meal_prep_portions ──────────────────────────────────────────────────────
create table if not exists meal_prep_portions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users not null,
  meal_prep_id uuid references meal_preps on delete cascade,
  date date not null,
  servings_consumed numeric default 1,
  created_at timestamptz default now()
);

alter table meal_prep_portions enable row level security;
create policy "Users own their portions" on meal_prep_portions for all using (auth.uid() = user_id);
