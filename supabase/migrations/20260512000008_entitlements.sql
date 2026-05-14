-- public.entitlements: per-user RevenueCat plan state. Always 'free' in v1.
-- Future RevenueCat webhook (service_role) writes upgrades to 'pro'.

create table public.entitlements (
  user_id                   uuid primary key references public.users(id) on delete cascade,
  plan                      text not null default 'free' check (plan in ('free','pro')),
  revenuecat_app_user_id    text,
  current_period_end        timestamptz,
  updated_at                timestamptz not null default now()
);

alter table public.entitlements enable row level security;

create policy "entitlements: select own"
  on public.entitlements for select
  using (auth.uid() = user_id);

-- INSERT/UPDATE/DELETE intentionally omitted — only service_role writes,
-- driven by the RevenueCat webhook (stubbed in v1, real in v2).