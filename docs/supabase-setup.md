# Supabase Setup

The Neurex app uses Supabase for Auth, Postgres, Storage, and Realtime session
updates. The live beta project is configured through EAS/app env vars and the
database schema is owned by the `neurex-backend` migrations.

## Live Project

- Supabase URL: `https://uunerbrscbswbzyxtdpg.supabase.co`
- Region: US East (`us-east-1`)
- Storage bucket: `recordings`
- Backend source of truth: `/Users/goda/neurex-backend/supabase/migrations`

Do not copy one-off SQL from this app repo into production. Add schema changes
as backend migrations, apply them to Supabase, then deploy the Modal backend.

## App Environment

Set these in `.env` for local development and in EAS for release builds:

| Variable | What it is |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `EXPO_PUBLIC_MODAL_ENDPOINT_URL` | Deployed `neurex-backend` endpoint |
| `EXPO_PUBLIC_DEV_BYPASS` | Optional. `1` shows a dev-only skip-login button |

## Current Data Flow

1. The phone streams one EEG channel from the sleep mask and writes
   `documentDirectory/sessions/<sessionId>/EEG.BIN`.
2. On stop or crash recovery, the app uploads the EEG file to
   `{user_id}/{readable-label}/segments/eeg/segNNNN.bin` in the `recordings`
   bucket.
3. The app inserts a `sessions` row with `status='uploaded'`.
4. The backend webhook/reconcile job assembles the segments into `eeg.bin`, runs
   staging, and updates the row to `status='ready'` or `status='failed'`.
5. The app listens to the session row over Realtime and renders ready nights in
   Journal.

The app uploads one EEG stream.

## Dashboard Settings

- Authentication -> Providers -> Email: enabled, email confirmations on.
- Authentication -> URL Configuration:
  - Site URL: `neurex://auth-callback`
  - Additional Redirect URLs:
    - `neurex://auth-callback`
    - `https://neurex.tech/auth-callback`
    - `exp://localhost:19000/--/auth-callback`

## Smoke Test

```bash
npm run smoke:auth -- your@email.com
```

Expected: a magic-link email arrives within about 10 seconds.
