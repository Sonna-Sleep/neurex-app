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

## What's gitignored

- `.env` — never commit this
- Anything with `service_role` — that key bypasses RLS, must never leave the
  server side
