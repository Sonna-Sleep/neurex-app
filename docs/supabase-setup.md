# Supabase Setup

The Neurex app uses Supabase for auth, Postgres, storage, and (later) realtime.
Project lives in EU region (Frankfurt or Dublin) for GDPR.

## Local dev

1. Copy `.env.example` to `.env`
2. Get URL + anon key from Supabase dashboard → Project Settings → API
3. Paste into `.env`
4. Run smoke test:
   ```
   npm run smoke:auth -- your@email.com
   ```
   Expected: magic-link email arrives within ~10s.

## Dashboard settings (must be configured ONCE per project)

- Authentication → Providers → Email: enabled, with email confirmations ON
- Authentication → URL Configuration:
  - Site URL: `neurex://auth-callback`
  - Additional Redirect URLs:
    - `neurex://auth-callback`
    - `https://neurex.tech/auth-callback`
    - `exp://localhost:19000/--/auth-callback`

## Region

- Primary: `eu-central-1` (Frankfurt)
- Fallback: `eu-west-1` (Dublin)
- US region added in v2 when justified by US user count.

## Migrations

Run these in the Supabase dashboard → SQL editor (one-off, per project).

### `user_push_tokens` — Expo push tokens for "Your night is ready" push

Lets the backend look up a user's device tokens and POST the overnight push
when a session flips to `status='ready'`. RLS-scoped so a user only sees/writes
their own tokens; the backend reads it with the service-role key.

```sql
create table public.user_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token text not null,
  platform text not null,
  updated_at timestamptz not null default now(),
  unique (user_id, token)
);
alter table public.user_push_tokens enable row level security;
create policy "own tokens" on public.user_push_tokens
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

The app upserts here on sign-in via `src/lib/push/registerPushToken.ts`
(`onConflict: 'user_id,token'`).

## What's gitignored

- `.env` — never commit this
- Anything with `service_role` — that key bypasses RLS, must never leave the
  server side
