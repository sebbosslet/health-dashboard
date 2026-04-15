-- Progress photos table (run this if progress_photos table is missing)
create table if not exists progress_photos (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  photo_date date not null,
  photo_type text not null default 'face', -- 'face' or 'upper'
  storage_path text not null,
  weight_at_time numeric,
  ai_observation text,
  created_at timestamptz default now()
);

alter table progress_photos enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies where tablename = 'progress_photos' and policyname = 'Users own their photos'
  ) then
    create policy "Users own their photos" on progress_photos for all using (auth.uid() = user_id);
  end if;
end $$;

-- Make sure the storage bucket exists with correct settings
-- Note: run this manually in Supabase dashboard if bucket doesn't exist:
-- Storage → New bucket → name: progress-photos → Private (NOT public)
