# Neurex

Mobile companion app for the Neurex EEG/EOG sleep mask. It connects to the
sleep mask over Bluetooth Low Energy, records the raw EEG/EOG biosignal stream
and optional IMU stream through the night, uploads the recording to the cloud,
and shows the finished session once backend QC/sleep analysis has completed.

Built with React Native + Expo (SDK 54, new architecture). iOS and Android.

## Features

- **BLE streaming** — pairs and streams the device-described EEG/EOG raw signal
  plus optional firmware-declared IMU notifications from one sleep mask
  (`src/lib/ble/`),
  with auto-reconnect/backoff and an Android foreground service
  (`modules/neurex-foreground-service/`) so recording survives the screen
  turning off.
- **Cloud sync** — each night is written as `RAW.BIN`, uploaded to Supabase
  Storage under `segments/raw`, and finalized with SHA-256 provenance,
  `scale.json`, `stream_stats.json`, and a stable per-recording prefix
  (`src/lib/cloud/cloudSync.ts`). When IMU is present, `IMU.BIN` is uploaded
  separately under `segments/imu` with `imu.json` provenance.
- **Automated analysis** — a serverless backend ([neurex-backend](https://github.com/aleksaspetro/neurex-backend))
  reads the uploaded EEG/EOG raw stream, writes one unified QC report to
  Supabase, and keeps beta sleep staging available for users who already rely on
  it.
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
| `npm run smoke:ble-reboot` | BLE reboot/resume handling smoke test |
| `npm run smoke:ble-watchdog` | BLE watchdog/drop accounting smoke test |
| `npm run smoke:ble-scale` | BLE scale sidecar parsing smoke test |
| `npm run smoke:raw-record` | EEG/EOG RAW.BIN writer smoke test |
| `npm run smoke:imu-record` | IMU.BIN notification-envelope smoke test |
| `npm run smoke:disk-space` | Overnight storage preflight smoke test |
| `npm run smoke:auto-stop` | Battery/device-lost auto-stop smoke test |
| `npm run smoke:stream-stats` | `stream_stats.json` sidecar smoke test |
| `npm run smoke:recovery` | Local recording recovery smoke test |
| `npm run smoke:account-deletion` | Account deletion API smoke test |
| `npm run smoke:profile` | Profile state smoke test |
| `npm run smoke:dob` | Date-of-birth validation smoke test |
| `npm run smoke:hypnogram` | Hypnogram rendering math smoke test |
| `npm run smoke:push` | Push token ownership/cleanup smoke test |
| `npm run smoke:support` | Support message smoke test |
| `npm run smoke:session-metadata` | Session metadata/provenance smoke test |
| `npm run smoke:upload-lock` | Upload lock timeout smoke test |
| `npm run smoke:recording-export-zip` | Recording export ZIP smoke test |
| `npm run check:android-push` | Android Firebase push config check |

## How a night flows

1. Phone connects to one sleep mask over BLE and reads the required Scale
   descriptor: sample rate, µV-per-LSB, firmware build, montage roles, and stream
   channel count. If firmware exposes the optional IMU notify characteristic, the
   app records it too.
2. The app records the EEG/EOG biosignal stream to one local `RAW.BIN` under the
   session directory. Current firmware writes compact 4-channel EEG/EOG records;
   legacy v3 full-8 recordings remain decodeable by metadata. Optional IMU
   notifications are preserved exactly as received in `IMU.BIN`, not mixed into
   `RAW.BIN`.
3. On stop, auto-stop, or recovery, the app uploads `RAW.BIN` to Supabase
   Storage as ordered `segments/raw/segNNNN.bin` chunks. If `IMU.BIN` exists,
   it uploads ordered `segments/imu/segNNNN.bin` chunks before finalize. The app
   computes whole-file SHA-256 hashes, uploads `scale.json`,
   `recording_manifest.json`, optional `imu.json`, and `stream_stats.json`, then
   inserts one `public.sessions` row.
4. The Modal backend reads the raw segments, verifies integrity, writes
   `signal_quality_report`, and preserves beta sleep staging.
5. The app reads the finished row and renders it in Journal.

IMU is intentionally separate from the EEG/EOG raw path. Firmware owns the IMU
payload schema; the app stores exact BLE notification payloads with receive
timestamps so the backend can decode the firmware-defined format later.

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
