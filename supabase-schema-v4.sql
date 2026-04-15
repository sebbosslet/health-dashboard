-- Recipes library
create table if not exists recipes (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  description text,
  servings int default 1,
  prep_time int,
  calories int,
  protein numeric,
  carbs numeric,
  fat numeric,
  ingredients text,
  instructions text,
  source text default 'manual',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table recipes enable row level security;
create policy "Users own their recipes" on recipes for all using (auth.uid() = user_id);

-- Meal prep batches
create table if not exists meal_preps (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  cook_date date not null,
  total_calories int,
  total_portions int not null default 4,
  portions_remaining int,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table meal_preps enable row level security;
create policy "Users own their meal preps" on meal_preps for all using (auth.uid() = user_id);

-- Individual portions from a meal prep
create table if not exists meal_prep_portions (
  id uuid default uuid_generate_v4() primary key,
  meal_prep_id uuid references meal_preps(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  portion_number int not null,
  calories int,
  used boolean default false,
  used_date date,
  created_at timestamptz default now()
);

alter table meal_prep_portions enable row level security;
create policy "Users own their portions" on meal_prep_portions for all using (auth.uid() = user_id);

-- Meal logs (individual meals logged during the day)
create table if not exists meal_logs (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  date date not null,
  meal_name text,
  meal_type text,
  calories int,
  protein numeric,
  carbs numeric,
  fat numeric,
  source text default 'manual',
  logged_at timestamptz default now()
);

alter table meal_logs enable row level security;
create policy "Users own their meal logs" on meal_logs for all using (auth.uid() = user_id);
