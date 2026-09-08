-- TrackMyFit — workout core schema.
-- Paste this whole file into the Supabase SQL editor and Run.
-- Safe to re-run: everything is drop-then-create.
--
-- RLS is ON with real per-user policies. Every row is reachable only by the
-- Supabase Auth account that owns it, so the anon key sitting in the client
-- bundle grants nothing on its own — a request has to carry a session.
--
-- Re-running this file wipes profiles and history but NOT auth.users, which
-- lives in a schema this script is not allowed to touch. Existing accounts
-- survive and land back on the "create your profile" screen at /users.

drop table if exists sets cascade;
drop table if exists exercise_logs cascade;
drop table if exists sessions cascade;
drop table if exists split_day_exercises cascade;
drop table if exists split_days cascade;
drop table if exists exercises cascade;
drop table if exists users cascade;

-- Profile, one row per Supabase Auth account. Reusing the auth uid as the primary
-- key is what lets every policy below compare against auth.uid() directly instead
-- of joining. Deleting the auth account cascades the profile and all its history.
create table users (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  age int,
  gender text,                                    -- 'male' | 'female' | 'other'
  height_cm numeric,                              -- always cm, whatever the display preference
  weight_kg numeric,                              -- always kg, whatever the display preference
  activity_level text,                            -- 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active'
  unit_preference text not null default 'metric', -- 'metric' | 'imperial' — display only, never storage
  created_at timestamptz not null default now()
);

-- Master exercise list
create table exercises (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  archetype text not null,      -- 'push' | 'pull' | 'legs' | 'core' | 'carry'
  muscle_group text not null,
  equipment text not null,      -- 'barbell' | 'dumbbell' | 'machine' | 'cable' | 'bodyweight'
  default_reps text,            -- target rep range, e.g. '8-12'. '--' = untracked (time-based)
  is_compound boolean not null default false
);

-- User's split (e.g. Push/Pull/Legs)
create table split_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  name text not null,           -- user-defined label, e.g. "Push Day"
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- Exercises assigned to a split day, in order
create table split_day_exercises (
  id uuid primary key default gen_random_uuid(),
  split_day_id uuid not null references split_days(id) on delete cascade,
  exercise_id uuid not null references exercises(id),
  sort_order int not null default 0
);

-- A logged workout session
create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  split_day_id uuid references split_days(id),
  status text not null default 'draft',   -- 'draft' | 'complete'
  started_at timestamptz not null default now(),
  completed_at timestamptz
);

-- At most one draft session per user, so "Resume Session" is never ambiguous.
create unique index sessions_one_draft_per_user on sessions (user_id) where status = 'draft';

-- The placeholder lookup (last completed log for a user+exercise) runs once per
-- exercise per session — it is the hottest query in the app.
create index sessions_user_completed on sessions (user_id, status, completed_at desc);

-- Individual exercise entries within a session.
-- Created lazily on the first set entered, so a skipped exercise leaves no empty row.
create table exercise_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  exercise_id uuid not null references exercises(id),
  sort_order int not null default 0,
  -- Both fields below are FORWARD-looking: they describe what to do NEXT time this
  -- exercise comes up, and are written when THIS session is finished. The next
  -- session reads them off the most recent completed log for the exercise.
  suggested_next_weight_kg numeric,
  is_deload boolean not null default false,
  unique (session_id, exercise_id)
);

create index exercise_logs_exercise on exercise_logs (exercise_id, session_id);

-- Individual sets within an exercise log
create table sets (
  id uuid primary key default gen_random_uuid(),
  exercise_log_id uuid not null references exercise_logs(id) on delete cascade,
  set_number int not null,
  weight_kg numeric not null,   -- always kg. 0 = bodyweight/unweighted.
  reps int not null,
  -- Makes every per-set save an idempotent upsert. This constraint IS the
  -- gym-wifi protection: without it, a retried save duplicates the set.
  unique (exercise_log_id, set_number)
);

-- ---------------------------------------------------------------------------
-- Data API exposure
-- ---------------------------------------------------------------------------
-- Supabase historically granted anon/authenticated access to new public tables
-- automatically, but is moving that to opt-in. Granting explicitly means this
-- schema works the same on old and new projects instead of failing with
-- "Could not find the table in the schema cache".
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

-- anon gets nothing. There is no signed-out feature in this app, and a table the
-- anon role cannot reach at all cannot be leaked by a policy mistake later.
revoke all on all tables in schema public from anon;
revoke usage on schema public from anon;

-- RLS: on for every table, one policy each, keyed to the signed-in account.
--
-- One "for all" policy per table rather than four, because the predicate is
-- identical across select/insert/update/delete here: "using" covers read, update
-- and delete, "with check" covers insert and update. Together they mean a row can
-- neither be read by another account nor reassigned to one.
--
-- auth.uid() is wrapped in (select ...) so the planner evaluates it once per
-- statement instead of once per row.
alter table users               enable row level security;
alter table exercises           enable row level security;
alter table split_days          enable row level security;
alter table split_day_exercises enable row level security;
alter table sessions            enable row level security;
alter table exercise_logs       enable row level security;
alter table sets                enable row level security;

-- You are your own profile row, and nobody else's.
create policy users_own on users for all to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Shared reference data: readable by anyone signed in, writable by nobody through
-- the API. New exercises land by editing the seed at the bottom of this file.
create policy exercises_read on exercises for select to authenticated
  using (true);

-- Owned directly.
create policy split_days_own on split_days for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy sessions_own on sessions for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Owned one hop up, through the split day.
create policy split_day_exercises_own on split_day_exercises for all to authenticated
  using (exists (
    select 1 from split_days d
    where d.id = split_day_exercises.split_day_id
      and d.user_id = (select auth.uid())))
  with check (exists (
    select 1 from split_days d
    where d.id = split_day_exercises.split_day_id
      and d.user_id = (select auth.uid())));

-- Owned one hop up, through the session.
create policy exercise_logs_own on exercise_logs for all to authenticated
  using (exists (
    select 1 from sessions s
    where s.id = exercise_logs.session_id
      and s.user_id = (select auth.uid())))
  with check (exists (
    select 1 from sessions s
    where s.id = exercise_logs.session_id
      and s.user_id = (select auth.uid())));

-- Owned two hops up: set -> exercise log -> session. Both hops are primary-key
-- lookups, so this stays cheap on the per-set writes during a workout.
create policy sets_own on sets for all to authenticated
  using (exists (
    select 1 from exercise_logs l
    join sessions s on s.id = l.session_id
    where l.id = sets.exercise_log_id
      and s.user_id = (select auth.uid())))
  with check (exists (
    select 1 from exercise_logs l
    join sessions s on s.id = l.session_id
    where l.id = sets.exercise_log_id
      and s.user_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Seed: master exercise list
-- ---------------------------------------------------------------------------
insert into exercises (name, archetype, muscle_group, equipment, default_reps, is_compound) values
  ('Barbell Bench Press',       'push',  'chest',      'barbell',    '8-12',  true),
  ('Incline DB Press',          'push',  'chest',      'dumbbell',   '8-12',  true),
  ('Overhead Press',            'push',  'shoulders',  'barbell',    '6-10',  true),
  ('DB Shoulder Press',         'push',  'shoulders',  'dumbbell',   '8-12',  true),
  ('Dips',                      'push',  'chest',      'bodyweight', '8-12',  true),
  ('Cable Fly',                 'push',  'chest',      'cable',      '10-15', false),
  ('Lateral Raise',             'push',  'shoulders',  'dumbbell',   '12-15', false),
  ('Tricep Pushdown',           'push',  'arms',       'cable',      '10-15', false),
  ('Overhead Tricep Extension', 'push',  'arms',       'dumbbell',   '10-15', false),
  ('Deadlift',                  'pull',  'back',       'barbell',    '3-6',   true),
  ('Barbell Row',               'pull',  'back',       'barbell',    '6-10',  true),
  ('Pull-up',                   'pull',  'back',       'bodyweight', '6-10',  true),
  ('Lat Pulldown',              'pull',  'back',       'cable',      '8-12',  true),
  ('Seated Cable Row',          'pull',  'back',       'cable',      '8-12',  true),
  ('Face Pull',                 'pull',  'shoulders',  'cable',      '12-15', false),
  ('Barbell Curl',              'pull',  'arms',       'barbell',    '8-12',  false),
  ('DB Curl',                   'pull',  'arms',       'dumbbell',   '8-12',  false),
  ('Hammer Curl',               'pull',  'arms',       'dumbbell',   '8-12',  false),
  ('Back Squat',                'legs',  'quads',      'barbell',    '5-8',   true),
  ('Front Squat',               'legs',  'quads',      'barbell',    '5-8',   true),
  ('Leg Press',                 'legs',  'quads',      'machine',    '8-12',  true),
  ('Romanian Deadlift',         'legs',  'hamstrings', 'barbell',    '6-10',  true),
  ('Leg Curl',                  'legs',  'hamstrings', 'machine',    '10-15', false),
  ('Leg Extension',             'legs',  'quads',      'machine',    '10-15', false),
  ('Walking Lunge',             'legs',  'glutes',     'dumbbell',   '8-12',  true),
  ('Bulgarian Split Squat',     'legs',  'glutes',     'dumbbell',   '8-12',  true),
  ('Hip Thrust',                'legs',  'glutes',     'barbell',    '8-12',  true),
  ('Calf Raise',                'legs',  'calves',     'machine',    '12-20', false),
  ('Plank',                     'core',  'core',       'bodyweight', '--',    false),
  ('Hanging Leg Raise',         'core',  'core',       'bodyweight', '10-15', false),
  ('Cable Crunch',              'core',  'core',       'cable',      '12-15', false),
  ('Russian Twist',             'core',  'core',       'bodyweight', '15-20', false),
  ('Farmer''s Carry',           'carry', 'full body',  'dumbbell',   '--',    true),
  ('Push-up',                   'push',  'chest',      'bodyweight', '10-20', true),
  ('Chin-up',                   'pull',  'back',       'bodyweight', '6-10',  true),
  ('Goblet Squat',              'legs',  'quads',      'dumbbell',   '8-12',  true),
  ('Arnold Press',              'push',  'shoulders',  'dumbbell',   '8-12',  true),
  ('T-Bar Row',                 'pull',  'back',       'barbell',    '6-10',  true),
  ('Sumo Deadlift',             'pull',  'back',       'barbell',    '3-6',   true),
  ('Skull Crusher',             'push',  'arms',       'barbell',    '10-15', false),
  ('Preacher Curl',             'pull',  'arms',       'barbell',    '8-12',  false);
