-- AI FIT COACH initial multi-tenant schema. Apply in a dedicated Supabase project.
create extension if not exists pgcrypto;
create table if not exists public.fitness_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(display_name) between 1 and 80),
  goal text not null check (goal in ('Allgemeine Fitness','Muskelaufbau','Abnehmen')),
  minutes_per_session integer not null check (minutes_per_session between 10 and 180),
  equipment text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.workout_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  duration_seconds integer not null default 0 check (duration_seconds between 0 and 86400),
  completed_exercises integer not null default 0 check (completed_exercises between 0 and 100),
  constraint completed_after_started check (completed_at is null or completed_at >= started_at)
);
create index if not exists workout_sessions_user_started_idx on public.workout_sessions(user_id, started_at desc);
create table if not exists public.coach_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_day date not null default current_date,
  request_count integer not null default 0 check (request_count >= 0),
  primary key (user_id, usage_day)
);
alter table public.fitness_profiles enable row level security;
alter table public.workout_sessions enable row level security;
alter table public.coach_usage enable row level security;
create policy "profile owner select" on public.fitness_profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "profile owner insert" on public.fitness_profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "profile owner update" on public.fitness_profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "profile owner delete" on public.fitness_profiles for delete to authenticated using ((select auth.uid()) = user_id);
create policy "sessions owner select" on public.workout_sessions for select to authenticated using ((select auth.uid()) = user_id);
create policy "sessions owner insert" on public.workout_sessions for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "sessions owner update" on public.workout_sessions for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "sessions owner delete" on public.workout_sessions for delete to authenticated using ((select auth.uid()) = user_id);
-- coach_usage deliberately has no client policies: server-only access.
