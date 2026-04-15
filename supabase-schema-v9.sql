-- Sleep HR analysis from WHOOP screenshots
create table if not exists sleep_hr_analysis (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null unique,
  -- Raw extracted data
  hr_baseline numeric,          -- avg floor HR during stable periods
  hr_max numeric,               -- peak HR recorded
  hr_min numeric,               -- lowest HR recorded
  hr_range numeric,             -- max - min (absolute scale)
  -- Spike analysis
  spike_count int,              -- number of significant spikes
  spike_avg_magnitude numeric,  -- avg spike height in absolute BPM
  spike_max_magnitude numeric,  -- biggest single spike
  -- Stability
  stable_pct numeric,           -- % of night where HR was stable (within 5bpm of baseline)
  fragmented_pct numeric,       -- % of night showing HR variability
  stability_score int,          -- 1-10 composite score (10 = perfectly stable)
  -- Context
  eye_bag_flag boolean default false,  -- user flagged eye bags this morning
  screenshot_path text,         -- storage path for the uploaded screenshot
  ai_analysis text,             -- full Claude analysis text
  axis_min numeric,             -- Y-axis min read from chart
  axis_max numeric,             -- Y-axis max read from chart
  created_at timestamptz default now()
);

alter table sleep_hr_analysis enable row level security;
create policy "Users own their sleep HR analysis" on sleep_hr_analysis for all using (auth.uid() = user_id);

-- Add eye bag flag to daily_logs morning checkin
alter table daily_logs add column if not exists eye_bags boolean default false;
