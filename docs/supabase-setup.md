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

## Current Data Flow

1. The phone streams schema-v3 four-channel EEG+EOG packets from the mask and
   writes exactly one local sample file:
   `documentDirectory/sessions/<sessionId>/RAW.BIN`.
2. On stop, auto-stop, or crash recovery, the app uploads `RAW.BIN` as ordered
   `{prefix}/segments/raw/segNNNN.bin` chunks and computes the whole-file
   SHA-256.
3. The app uploads `scale.json`, `recording_manifest.json`, and
   `stream_stats.json`, then finalizes the `sessions` row with `raw_sha256` and
   `raw_storage_path`.
4. The backend verifies the assembled `segments/raw` bytes against
   `raw_sha256`, stages the authoritative multichannel signal, and updates the
   row to `status='ready'` or `status='failed'`.
5. The app deletes the local session only after finalize succeeds, then listens
   to the session row over Realtime and renders ready nights in Journal.

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
