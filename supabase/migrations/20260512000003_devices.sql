-- public.devices: each Neurex headband owned by a user.
-- hardware_id is the device's globally-unique serial (BLE MAC or stamped serial).

create table public.devices (
  id               uuid primary key default gen_random_uuid(),
  owner_user_id    uuid not null references public.users(id) on delete cascade,
  hardware_id      text not null unique,
  color_variant    text check (color_variant in ('yellow','red','production')),
  firmware_version text,
  last_seen_at     timestamptz,
  claimed_at       timestamptz not null default now()
);

create index devices_owner_idx on public.devices(owner_user_id);

alter table public.devices enable row level security;

create policy "devices: select own"
  on public.devices for select
  using (auth.uid() = owner_user_id);

create policy "devices: insert own"
  on public.devices for insert
  with check (auth.uid() = owner_user_id);

create policy "devices: update own"
  on public.devices for update
  using (auth.uid() = owner_user_id)
  with check (auth.uid() = owner_user_id);

create policy "devices: delete own"
  on public.devices for delete
  using (auth.uid() = owner_user_id);