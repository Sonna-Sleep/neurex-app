-- public.pro_waitlist: Pro paywall preview email captures.
-- Read-only for service_role (Plan B3 admin export to Resend audience).

create table public.pro_waitlist (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid references public.users(id) on delete set null,
  email         text not null,
  signed_up_at  timestamptz not null default now(),
  unique (email)
);

create index pro_waitlist_signed_up_at_idx on public.pro_waitlist(signed_up_at desc);

alter table public.pro_waitlist enable row level security;

create policy "pro_waitlist: insert authenticated"
  on public.pro_waitlist for insert
  to authenticated
  with check (
    user_id is null or auth.uid() = user_id
  );

-- No SELECT / UPDATE / DELETE policy — only service_role reads/admins.