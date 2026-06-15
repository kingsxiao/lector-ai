-- Lector AI — Supabase schema
-- Run in the Supabase SQL editor. All tables are safe to re-run (IF NOT EXISTS).
--
-- Notes:
--  * We use the service-role key server-side, so RLS is bypassed. Keep RLS
--    enabled for defense in depth; these policies allow authenticated owners
--    to read their own rows.
--  * `subscriptions` is the source of truth for Pro status. The LemonSqueezy
--    webhook writes here; /auth/me and the rate limiter read from here.

-- ---------------------------------------------------------------------------
-- Subscriptions (Pro status)
-- ---------------------------------------------------------------------------
create table if not exists public.subscriptions (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  status            text not null default 'active',   -- active | on_trial | cancelled | expired
  lemonsqueezy_id   text,
  variant_id        text,
  renews_at         timestamptz,
  ends_at           timestamptz,
  updated_at        timestamptz not null default now()
);

alter table public.subscriptions enable row level security;

drop policy if exists "users read own subscription" on public.subscriptions;
create policy "users read own subscription"
  on public.subscriptions for select
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Daily usage counter (authenticated users)
-- ---------------------------------------------------------------------------
create table if not exists public.usage_daily (
  user_id   uuid not null references auth.users(id) on delete cascade,
  day       date not null default current_date,
  count     integer not null default 0,
  primary key (user_id, day)
);

alter table public.usage_daily enable row level security;

drop policy if exists "users read own usage" on public.usage_daily;
create policy "users read own usage"
  on public.usage_daily for select
  using (auth.uid() = user_id);

-- Auto-prune old rows (keep the table small). Optional.
-- create index if not exists usage_daily_day_idx on public.usage_daily (day);

-- ---------------------------------------------------------------------------
-- Anonymous usage counter (per IP, rotated daily)
--  * anon_id is the client IP resolved from request headers. It is NOT PII we
--    display; we only need it to be a stable daily key for rate limiting.
-- ---------------------------------------------------------------------------
create table if not exists public.anon_usage (
  anon_id   text not null,
  day       date not null default current_date,
  count     integer not null default 0,
  primary key (anon_id, day)
);

alter table public.anon_usage enable row level security;

-- ---------------------------------------------------------------------------
-- Convenience: a function the rate limiter could call to atomically bump.
-- (We currently bump client-side in JS for simplicity; included for future use.)
-- ---------------------------------------------------------------------------
create or replace function public.bump_usage(p_user uuid)
returns integer
language plpgsql
security definer
as $$
declare
  new_count integer;
begin
  insert into public.usage_daily (user_id, day, count)
  values (p_user, current_date, 1)
  on conflict (user_id, day)
  do update set count = public.usage_daily.count + 1
  returning count into new_count;
  return new_count;
end;
$$;
