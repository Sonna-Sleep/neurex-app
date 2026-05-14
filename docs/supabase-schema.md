# Supabase Schema — Neurex App v1

Reference: spec §8 (Data Model) of `2026-05-10-neurex-app-lean-mvp-design.md` in
`aleksaspetro/neurex-algorithms` (`Neurex_app` branch).

Project: `Neurex_app_MVP` — ref `qjkbkkposdczkyzbrtdw`, region East US (us-east-1).

## Tables (9)

| Table | Owner-scoped? | Purpose |
|---|---|---|
| `users` | own row (`id = auth.uid()`) | Profile (DOB, sex, height, weight, sleep goal, bedtime reminder, TZ) |
| `devices` | own (`owner_user_id`) | Headbands claimed by this user |
| `sessions` | own (`user_id`) | One row per night; state machine + staging results |
| `recordings` | own (via session) | Chunks of raw EEG, pointer to Supabase Storage |
| `pulses` | own (via session, read-only) | Each stim event, written by Modal |
| `push_tokens` | own (`user_id`) | Expo push tokens |
| `entitlements` | own (`user_id`, read-only) | RevenueCat plan state (free/pro) |
| `pro_waitlist` | insert-only (auth) | Pro paywall preview email captures |
| `score_config` | read-all (auth) | Tunable Sleep Score weights + reference curves |

## RLS Matrix

|              | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `users`        | own | trigger only | own | none (soft-delete via deleted_at) |
| `devices`      | own | own | own | own |
| `sessions`     | own | own | own rows, **only `state`/`end_ts`/`journal_tags` columns** | own |
| `recordings`   | own | own | own | own |
| `pulses`       | own | service_role | service_role | service_role |
| `push_tokens`  | own | own | own | own |
| `entitlements` | own | service_role | service_role | service_role |
| `pro_waitlist` | service_role | authenticated | service_role | service_role |
| `score_config` | authenticated | service_role | service_role | service_role |

"own" = the policy `auth.uid() = <owner_column>` (or the equivalent via subquery on the parent session row).

### Why `sessions` UPDATE is column-restricted

Postgres RLS policies gate **rows**, not **columns**. The `sessions: update own`
policy alone would let a client update any column on its own row — including
`sleep_score` and the staging metrics, i.e. fake its own Sleep Score. Migration
`20260512000012_sessions_column_grants.sql` fixes this with a column-level GRANT:
the `authenticated` role may only UPDATE `state`, `end_ts`, `journal_tags`.
`service_role` (Modal staging, Plan B8) bypasses both RLS and column grants and
writes every column.

## Migrations

Files in `supabase/migrations/`, timestamps in UTC, one table per file with RLS
inline:

| # | File | Contents |
|---|---|---|
| 01 | `..._extensions.sql` | pgcrypto, uuid-ossp |
| 02 | `..._users.sql` | `users` + RLS |
| 03 | `..._devices.sql` | `devices` + RLS |
| 04 | `..._sessions.sql` | `sessions` + RLS + indexes |
| 05 | `..._recordings.sql` | `recordings` + RLS (session-scoped) |
| 06 | `..._pulses.sql` | `pulses` + RLS (session-scoped, read-only) |
| 07 | `..._push_tokens.sql` | `push_tokens` + RLS |
| 08 | `..._entitlements.sql` | `entitlements` + RLS (read-only) |
| 09 | `..._pro_waitlist.sql` | `pro_waitlist` + RLS (insert-only) |
| 10 | `..._score_config.sql` | `score_config` + RLS + 6 seed rows |
| 11 | `..._handle_new_user_trigger.sql` | on-signup trigger → `users` + `entitlements` |
| 12 | `..._sessions_column_grants.sql` | column-level UPDATE grant on `sessions` |

Always create new migrations with `supabase migration new <name>`; never edit a
migration that has been pushed.

## Local workflow

```bash
# One-time, per machine:
supabase login --token <your-management-api-token>
supabase link --project-ref qjkbkkposdczkyzbrtdw

# After editing/adding a migration:
npm run db:push       # apply local migrations to remote
npm run db:types      # regenerate src/types/database.ts
npm run smoke:rls -- <jwt-A> <jwt-B>   # validate RLS still holds
```

## score_config seed (spec §7)

| key | value |
|---|---|
| `weights` | efficiency .40, deep .25, rem .15, awakenings .10, stim_impact .10 |
| `age_expected_deep_min` | 5 age bins, 18–99, 75→35 min (Ohayon 2004 midpoints) |
| `age_expected_rem_min` | 5 age bins, 18–99, 100→70 min |
| `awakenings_penalty` | `saturation_count` = 6 |
| `stim_impact` | `saturation_pct` = 30 |
| `score_cap` | `max` = 99 (the intentional unreachable ceiling) |

The app reads these live from `score_config` — it never hardcodes the weights,
so the formula is tunable without an app release.

## Spec deviations

| Spec | Implementation | Reason |
|---|---|---|
| `users.cognito_sub` | dropped — `users.id` references `auth.users.id` | Supabase Auth replaces Cognito |
| `push_tokens.sns_endpoint_arn` | dropped — only `expo_push_token` | Expo push, not SNS |
| `recordings.s3_key` | renamed `storage_path` | Supabase Storage |

## What's NOT in B2 (deferred)

- `raw-eeg` storage bucket + storage policies (Plan B8 creates + writes them)
- Edge Function `staging-trigger` (Plan B8)
- RevenueCat webhook endpoint (Plan B9 / v2)
- `/me/export` GDPR data export endpoint (Plan B7)
- A trigger enforcing valid `sessions.state` transitions (post-MVP hardening)
