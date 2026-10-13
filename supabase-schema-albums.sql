-- ============================================================
-- Vacation diary — albums, photos, and notes, day by day.
-- Public contribution is via an unguessable share token, validated
-- server-side; the browser anon key cannot read or write these tables.
-- ============================================================

create table if not exists albums (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade,
  title        text not null,
  subtitle     text,
  start_date   date,
  end_date     date,
  share_token  text not null unique default encode(gen_random_bytes(16), 'hex'),
  cover_path   text,
  created_at   timestamptz not null default now()
);

create table if not exists album_photos (
  id           uuid primary key default gen_random_uuid(),
  album_id     uuid not null references albums(id) on delete cascade,
  storage_path text not null,
  taken_on     date not null,                 -- the day it belongs under (from EXIF, or set)
  caption      text,
  author_name  text,                          -- free-text name for public contributors
  width        int,
  height       int,
  sort         numeric not null default 0,
  created_at   timestamptz not null default now()
);

create table if not exists album_notes (
  id           uuid primary key default gen_random_uuid(),
  album_id     uuid not null references albums(id) on delete cascade,
  note_date    date not null,                 -- which day this note is about
  body         text not null,
  author_name  text,
  created_at   timestamptz not null default now()
);

create index if not exists idx_album_photos on album_photos (album_id, taken_on, sort);
create index if not exists idx_album_notes  on album_notes  (album_id, note_date, created_at);

-- RLS: owner manages their own albums through the logged-in app.
-- Public (link-based) reads and writes go through a service-key function,
-- so these tables have NO anon policy — the browser can't touch them directly.
alter table albums        enable row level security;
alter table album_photos  enable row level security;
alter table album_notes   enable row level security;

drop policy if exists "Owner manages albums" on albums;
create policy "Owner manages albums" on albums
  for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);

drop policy if exists "Owner manages album photos" on album_photos;
create policy "Owner manages album photos" on album_photos
  for all using (exists (select 1 from albums a where a.id = album_id and a.owner_id = auth.uid()))
  with check (exists (select 1 from albums a where a.id = album_id and a.owner_id = auth.uid()));

drop policy if exists "Owner manages album notes" on album_notes;
create policy "Owner manages album notes" on album_notes
  for all using (exists (select 1 from albums a where a.id = album_id and a.owner_id = auth.uid()))
  with check (exists (select 1 from albums a where a.id = album_id and a.owner_id = auth.uid()));
