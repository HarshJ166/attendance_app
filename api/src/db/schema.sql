-- GeoMark schema. Idempotent: safe to run on every deploy (npm run migrate).

create table if not exists sites (
  id        serial primary key,
  name      text not null,
  lat       double precision not null check (lat between -90 and 90),
  lng       double precision not null check (lng between -180 and 180),
  radius_m  integer not null default 150 check (radius_m between 10 and 5000)
);

create table if not exists users (
  id          serial primary key,
  auth0_sub   text not null unique,
  email       text,
  name        text not null default '',
  site_id     integer references sites(id),
  created_at  timestamptz not null default now()
);

create table if not exists attendance (
  id          bigserial primary key,
  user_id     integer not null references users(id),
  day         date not null,                       -- IST calendar day, set by the server
  marked_at   timestamptz not null default now(),  -- server clock, never the phone's
  lat         double precision not null,
  lng         double precision not null,
  accuracy_m  real not null,
  mocked      boolean not null,
  site_id     integer references sites(id),
  distance_m  integer,
  photo_key   text not null,                       -- R2 object key of the selfie (checked to exist)
  status      text not null check (status in ('present', 'flagged')),
  flags       text[] not null default '{}',
  unique (user_id, day)                            -- one attendance per person per day
);

create index if not exists attendance_day_idx on attendance (day);

-- Upgrade for databases created before selfies were required (no-op once applied).
alter table attendance alter column photo_key set not null;

-- DPDP consent: when the person agreed to selfie + location use (null = not yet).
alter table users add column if not exists consented_at timestamptz;

-- Street address looked up at check-in (OpenStreetMap). Display only; lat/lng are the source of truth.
alter table attendance add column if not exists address text;

-- ===== Step A (2026-11-08): many places per person, late, blocked attempts =====

-- A place is an office/branch or someone's home (work from home). Home pins are HR-only data (DPDP).
alter table sites add column if not exists kind text not null default 'office';
do $$ begin
  alter table sites add constraint sites_kind_check check (kind in ('office', 'home'));
exception when duplicate_object then null; end $$;

-- Who may check in where. A check-in passes inside ANY of the person's places.
create table if not exists user_sites (
  user_id integer not null references users(id) on delete cascade,
  site_id integer not null references sites(id) on delete cascade,
  primary key (user_id, site_id)
);
-- Carry over the old single-office assignment. (users.site_id is now unused; kept to avoid destructive changes.)
insert into user_sites (user_id, site_id) select id, site_id from users where site_id is not null on conflict do nothing;

alter table users add column if not exists active boolean not null default true;

-- One row of company settings. Late = checked in after shift_start + grace_min (IST).
create table if not exists settings (
  id          integer primary key default 1 check (id = 1),
  shift_start time not null default '09:30',
  grace_min   integer not null default 15 check (grace_min between 0 and 240)
);
insert into settings (id) values (1) on conflict do nothing;

-- Stored at check-in so changing the shift time later doesn't rewrite history.
alter table attendance add column if not exists late_min integer not null default 0;

-- Blocked check-ins (outside every place, fake GPS, no place). No photo is kept.
create table if not exists checkin_attempts (
  id          bigserial primary key,
  user_id     integer not null references users(id) on delete cascade,
  at          timestamptz not null default now(),
  lat         double precision not null,
  lng         double precision not null,
  accuracy_m  real not null,
  mocked      boolean not null,
  reason      text not null check (reason in ('outside_site', 'mock_location', 'no_site')),
  site_id     integer references sites(id) on delete set null,  -- nearest place
  distance_m  integer
);
create index if not exists checkin_attempts_at_idx on checkin_attempts (at);

-- ===== Step B (2026-11-08): admin panel =====

-- Employee profile (HR-entered).
alter table users add column if not exists employee_code text;
alter table users add column if not exists phone text;
alter table users add column if not exists designation text;
alter table users add column if not exists role text not null default 'employee';
do $$ begin
  alter table users add constraint users_role_check check (role in ('employee', 'admin'));
exception when duplicate_object then null; end $$;
create unique index if not exists users_employee_code_key on users (employee_code) where employee_code is not null;
create unique index if not exists users_email_key on users (lower(email)) where email is not null;

-- HR review of "HR check" items: approve (counts present) or reject (counts absent). Who/when/why is kept.
alter table attendance drop constraint if exists attendance_status_check;
alter table attendance add constraint attendance_status_check check (status in ('present', 'flagged', 'rejected'));
alter table attendance add column if not exists reviewed_by integer references users(id);
alter table attendance add column if not exists reviewed_at timestamptz;
alter table attendance add column if not exists review_note text;

-- ===== Holidays (2026-11-08) =====
-- Company holidays, added by HR. Like Sunday: nobody is absent; anyone who checks in still counts as present.
create table if not exists holidays (
  day         date primary key,
  name        text not null check (length(name) between 1 and 80),
  created_by  integer references users(id) on delete set null,
  created_at  timestamptz not null default now()
);
