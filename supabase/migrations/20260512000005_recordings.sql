-- public.recordings: chunks of raw EEG uploaded to Supabase Storage.
-- storage_path points to an object in the (future) "raw-eeg" bucket created
-- in Plan B8. state machine: on_device -> uploading -> uploaded -> staged.

create table public.recordings (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.sessions(id) on delete cascade,
  chunk_idx     int  not null,
  storage_path  text,
  bytes         bigint check (bytes >= 0),
  sha256        text  check (char_length(sha256) = 64),
  state         text  not null default 'on_device'
                 check (state in ('on_device','uploading','uploaded','staged')),
  created_at    timestamptz not null default now(),
  unique (session_id, chunk_idx)
);

create index recordings_session_idx on public.recordings(session_id);
create index recordings_state_idx   on public.recordings(state) where state <> 'staged';

alter table public.recordings enable row level security;

-- Access through the parent session's ownership.
create policy "recordings: select own"
  on public.recordings for select
  using (exists (
    select 1 from public.sessions s
    where s.id = recordings.session_id and s.user_id = auth.uid()
  ));

create policy "recordings: insert own"
  on public.recordings for insert
  with check (exists (
    select 1 from public.sessions s
    where s.id = recordings.session_id and s.user_id = auth.uid()
  ));

create policy "recordings: update own"
  on public.recordings for update
  using (exists (
    select 1 from public.sessions s
    where s.id = recordings.session_id and s.user_id = auth.uid()
  ));

create policy "recordings: delete own"
  on public.recordings for delete
  using (exists (
    select 1 from public.sessions s
    where s.id = recordings.session_id and s.user_id = auth.uid()
  ));