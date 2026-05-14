-- public.push_tokens: Expo push tokens for the bedtime reminder + morning
-- "your night is ready" notification. SNS endpoint ARN dropped vs spec —
-- we send through Expo's push service in v1.

create table public.push_tokens (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  platform          text not null check (platform in ('ios','android')),
  expo_push_token   text not null,
  created_at        timestamptz not null default now(),
  revoked_at        timestamptz,
  unique (user_id, expo_push_token)
);

create index push_tokens_user_idx on public.push_tokens(user_id) where revoked_at is null;

alter table public.push_tokens enable row level security;

create policy "push_tokens: select own"
  on public.push_tokens for select
  using (auth.uid() = user_id);

create policy "push_tokens: insert own"
  on public.push_tokens for insert
  with check (auth.uid() = user_id);

create policy "push_tokens: update own"
  on public.push_tokens for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "push_tokens: delete own"
  on public.push_tokens for delete
  using (auth.uid() = user_id);