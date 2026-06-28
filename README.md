# Neurex

Mobile companion app for the Neurex EEG sleep mask. It connects to the
sleep mask over Bluetooth Low Energy, records EEG through the night, uploads the
recording to the cloud, and shows the finished session once backend QC/sleep
analysis has completed.

Built with React Native + Expo (SDK 54, new architecture). iOS and Android.

## Features

- **BLE streaming** — pairs and streams from one sleep mask (`src/lib/ble/`),
  with auto-reconnect/backoff and an Android foreground service
  (`modules/neurex-foreground-service/`) so recording survives the screen
  turning off.
- **Cloud sync** — recordings upload to Supabase Storage in resumable segments,
  with retry and a stable per-recording prefix so interrupted uploads resume
  instead of starting over (`src/lib/cloud/cloudSync.ts`).
- **Automated analysis** — a serverless backend ([neurex-backend](https://github.com/aleksaspetro/neurex-backend))
  reads the uploaded EEG segments, writes one unified QC report to Supabase, and
  keeps beta sleep staging available for users who already rely on it.
- **Journal** — past nights with a detail view per session.
- **Email auth** — passwordless magic-link login via Supabase Auth.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | React Native 0.81 + Expo SDK 54 (new arch) |
| Language | TypeScript |
| Navigation | React Navigation (native-stack + bottom-tabs) |
| State | Zustand |
| Backend | Supabase (Auth, Postgres, Storage) |
| Analysis | Modal serverless QC + beta sleep staging — separate `neurex-backend` repo |
| BLE | `react-native-ble-plx` |
| Charts | `react-native-svg` |

## Project structure

```
src/
  screens/        onboarding, home, journal, account
  lib/
    ble/          BLE connect + single-device streaming
    cloud/        segment upload + resume to Supabase Storage
    auth/         Supabase magic-link auth
    repos/        Supabase data access
    notifications/ local notifications
  state/          Zustand stores
  theme/          design tokens (colors, layout)
  components/     shared UI
  navigation/     navigators
modules/
  neurex-foreground-service/   native Android module (keep recording alive)
scripts/          smoke tests (BLE, segment upload, recovery, profile, support)
docs/             Supabase, app review, listing, and legal notes
```

## Prerequisites

- Node 18+ and npm
- A development build is required (this app uses native modules — BLE and the
  foreground service — so it won't run in Expo Go). Use a physical device for
  BLE; an emulator can't talk to the sleep mask.
- Android: Android Studio + SDK. iOS: Xcode (macOS only).

## Setup

```bash
npm install
cp .env.example .env   # then fill in the values below
```

Set these in `.env`:

| Variable | What it is |
|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon/public key |
| `EXPO_PUBLIC_MODAL_ENDPOINT_URL` | Deployed staging endpoint (neurex-backend) |

## Running

```bash
# Android dev build (device or emulator)
npm run android

# iOS dev build (macOS)
npm run ios

# Start the dev server only (for an already-installed dev build)
npm start
```

## Building a release APK (Android, local)

```bash
npx expo prebuild --platform android
cd android
./gradlew assembleRelease
# APK: android/app/build/outputs/apk/release/app-release.apk
```

Install with `adb install -r <apk>` (in-place `-r` preserves app data).

## Scripts

| Command | Purpose |
|---|---|
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run smoke:auth` | Auth flow smoke test |
| `npm run smoke:ble-packet` | BLE packet decoder smoke test |
| `npm run smoke:backoff` | BLE reconnect/backoff smoke test |
| `npm run smoke:connect-timeout` | BLE connection timeout smoke test |
| `npm run smoke:ble-scale` | BLE scale sidecar parsing smoke test |
| `npm run smoke:raw-record` | Raw diagnostic capture smoke test |
| `npm run smoke:disk-space` | Overnight storage preflight smoke test |
| `npm run smoke:auto-stop` | Battery/device-lost auto-stop smoke test |
| `npm run smoke:seg-roll` | Segment rolling boundary smoke test |
| `npm run smoke:chunk-queue` | Segment upload queue smoke test |
| `npm run smoke:chunk-upload` | Segment upload worker smoke test |
| `npm run smoke:chunk-uploader` | `/ingest` uploader contract smoke test |
| `npm run smoke:stream-stats` | `stream_stats.json` sidecar smoke test |
| `npm run smoke:recovery` | Local recording recovery smoke test |
| `npm run smoke:account-deletion` | Account deletion API smoke test |
| `npm run smoke:profile` | Profile state smoke test |
| `npm run smoke:dob` | Date-of-birth validation smoke test |
| `npm run smoke:hypnogram` | Hypnogram rendering math smoke test |
| `npm run smoke:push` | Push token ownership/cleanup smoke test |
| `npm run smoke:support` | Support message smoke test |
| `npm run smoke:diagnostic-capture` | Raw diagnostic capture setting smoke test |
| `npm run smoke:session-metadata` | Session metadata/provenance smoke test |
| `npm run smoke:upload-lock` | Upload lock timeout smoke test |

## How a night flows

1. Phone connects to one sleep mask over BLE and streams EEG, buffered to disk by
   a foreground service.
2. During the recording, the app writes `segments/eeg/segNNNN.bin`, uploads each
   closed segment, and deletes local chunks only after server byte/hash
   confirmation.
3. On stop, auto-stop, or recovery, the app uploads `scale.json` and
   `stream_stats.json`, then inserts one `public.sessions` row.
4. The Modal backend reads the segments, writes `signal_quality_report`, and
   preserves beta sleep staging.
5. The app reads the finished row and renders it in Journal.

## Android push setup

Android push notifications require a `google-services.json` file in the repo root and an FCM V1 service account key uploaded to EAS. **Pushes will not work on Android until these steps are done.**

`google-services.json` is safe to commit — it contains only public identifiers and a restricted API key (standard Expo practice).

**(a) Download google-services.json**

1. Open the [Firebase console](https://console.firebase.google.com/) and open (or create) a project for the app's Android package name: `tech.neurex.app`.
2. Go to **Project settings** (gear icon) → **General** → scroll to **Your apps** → Android app.
3. Click **Download google-services.json** and place the file in the **repo root** (next to `app.json`).
4. Verify it matches the app package: `npm run check:android-push`
5. Commit it: `git add google-services.json && git commit -m "chore: add google-services.json for Android FCM"`

**(b) Upload FCM V1 service account key to EAS**

1. In the same Firebase project: **Project settings** → **Service accounts** → **Generate new private key** → download the JSON file.
2. Run:
   ```
   eas credentials
   ```
   Select **Android** → select the app → **Push Notifications (FCM V1)** → upload the service account key.

**(c) Rebuild**

```bash
eas build --platform android
```

Push notifications will be active in the new build.

## License

Private. © Neurex.
