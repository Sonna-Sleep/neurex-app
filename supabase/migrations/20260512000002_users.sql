-- public.users: profile data keyed to auth.users.id.
-- A row is created automatically on auth signup via the trigger in
-- 20260512000011_handle_new_user_trigger.sql.

create table public.users (
  id                      uuid primary key references auth.users(id) on delete cascade,
  email                   text unique not null,
  dob                     date,
  sex                     text check (sex in ('male','female','other','prefer_not_to_say')),
  height_cm               int  check (height_cm  between 100 and 250),
  weight_kg               int  check (weight_kg  between 30  and 250),
  sleep_goal_min          int  check (sleep_goal_min between 300 and 720) default 480,
  bedtime_reminder_local  time,
  timezone                text default 'Etc/UTC',
  created_at              timestamptz not null default now(),
  deleted_at              timestamptz
);

comment on table public.users is 'Neurex user profile, 1:1 with auth.users.';

alter table public.users enable row level security;

create policy "users: select own"
  on public.users for select
  using (auth.uid() = id);

create policy "users: update own"
  on public.users for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- No INSERT policy on purpose — the on_auth_user_created trigger uses
-- security definer and bypasses RLS. Manual inserts from the client are
-- intentionally blocked.

-- No DELETE policy — GDPR deletion goes through a soft-delete (set deleted_at)
-- triggered by the future /me DELETE endpoint, then S3 lifecycle purges raw
-- data in 30 days.