-- Trigger: on auth signup, create the matching public.users + free entitlement.
-- `security definer` so the function runs as the schema owner and bypasses RLS.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, timezone)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'timezone', 'Etc/UTC'))
  on conflict (id) do nothing;

  insert into public.entitlements (user_id, plan)
  values (new.id, 'free')
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
