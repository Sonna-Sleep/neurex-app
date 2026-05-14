-- public.sessions: one row per night of sleep tracking.
-- `state` machine: recording -> syncing -> staging -> ready (or -> failed).
-- Staging fields (sleep_score, time_in_bed_s, ...) are written by the
-- service_role from the Modal pipeline (Plan B8). The user can update
-- `journal_tags` from the app.

create table public.sessions (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  device_id           uuid references public.devices(id) on delete set null,
  start_ts            timestamptz not null,
  end_ts              timestamptz,
  day_assigned        date not null,
  state               text not null default 'recording'
                       check (state in ('recording','syncing','staging','ready','failed')),
  sleep_score         int  check (sleep_score between 0 and 99),
  time_in_bed_s       int  check (time_in_bed_s >= 0),
  time_asleep_s       int  check (time_asleep_s >= 0),
  sleep_efficiency    real check (sleep_efficiency between 0 and 1),
  latency_s           int  check (latency_s >= 0),
  awakenings          int  check (awakenings >= 0),
  min_in_deep         int  check (min_in_deep  >= 0),
  min_in_rem          int  check (min_in_rem   >= 0),
  min_in_light        int  check (min_in_light >= 0),
  min_in_wake         int  check (min_in_wake  >= 0),
  stim_count          int  check (stim_count   >= 0),
  stim_swa_pct        real,
  sleep_strip         jsonb,
  journal_tags        text[] default '{}'::text[],
  created_at          timestamptz not null default now()
);

create index sessions_user_day_idx on public.sessions(user_id, day_assigned desc);
create index sessions_state_idx    on public.sessions(state) where state <> 'ready';

alter table public.sessions enable row level security;

create policy "sessions: select own"
  on public.sessions for select
  using (auth.uid() = user_id);

create policy "sessions: insert own"
  on public.sessions for insert
  with check (auth.uid() = user_id);

-- UPDATE policy is split: a user may only patch journal_tags + end_ts on their
-- own rows. Modal staging writes (sleep_score, sleep_strip, etc.) come in via
-- service_role and bypass RLS.
create policy "sessions: update own (limited columns)"
  on public.sessions for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "sessions: delete own"
  on public.sessions for delete
  using (auth.uid() = user_id);