-- public.pulses: every stim event delivered during a session.
-- Written by the Modal staging pipeline (Plan B8) via service_role.
-- Users read for the Stim Impact card; they never write.

create table public.pulses (
  id            bigserial primary key,
  session_id    uuid not null references public.sessions(id) on delete cascade,
  ts_ms         bigint not null,
  frequency     real,
  amplitude_db  real,
  phase_deg     real,
  on_target     boolean not null default false
);

create index pulses_session_idx on public.pulses(session_id);

alter table public.pulses enable row level security;

create policy "pulses: select own"
  on public.pulses for select
  using (exists (
    select 1 from public.sessions s
    where s.id = pulses.session_id and s.user_id = auth.uid()
  ));

-- No INSERT / UPDATE / DELETE policy — service_role inserts are unaffected
-- by RLS, and clients must never write here.