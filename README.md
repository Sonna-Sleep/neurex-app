# Neurex

Mobile companion app for the Neurex EEG sleep headband. It connects to the
headband over Bluetooth Low Energy, records EEG (and optional EOG) through the
night, uploads the recording to the cloud, and shows you a staged hypnogram and
a sleep score the next morning.

Built with React Native + Expo (SDK 54, new architecture). iOS and Android.

## Features

- **BLE streaming** — pairs and streams from one or two headbands at once
  (`src/lib/ble/`), with auto-reconnect/backoff and an Android foreground
  service (`modules/neurex-foreground-service/`) so recording survives the
  screen turning off.
- **Cloud sync** — recordings upload to Supabase Storage in resumable segments,
  with retry and a stable per-recording prefix so interrupted uploads resume
  instead of starting over (`src/lib/cloud/cloudSync.ts`).
- **Sleep staging** — a serverless backend ([neurex-backend](https://github.com/aleksaspetro/neurex-backend))
  runs YASA on the uploaded EEG, writes a session row back to Supabase, and the
  app renders the hypnogram, stage breakdown, and score.
- **History** — past nights with per-device tags and a detail view per session.
- **Email auth** — passwordless magic-link login via Supabase Auth.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | React Native 0.81 + Expo SDK 54 (new arch) |
| Language | TypeScript |
| Navigation | React Navigation (native-stack + bottom-tabs) |
| State | Zustand |
| Backend | Supabase (Auth, Postgres, Storage) |
| Staging | Modal serverless (YASA) — separate `neurex-backend` repo |
| BLE | `react-native-ble-plx` |
| Charts | `react-native-svg` |

## Project structure

```
src/
  screens/        onboarding, home, history, account
  lib/
    ble/          BLE connect, multi-device controller, recovery
    cloud/        segment upload + resume to Supabase Storage
    auth/         Supabase magic-link auth
    repos/        Supabase data access
    upload/        recording → cloud orchestration
    notifications/ local notifications
  state/          Zustand stores
  theme/          design tokens (colors, layout)
  components/     shared UI
  navigation/     navigators
modules/
  neurex-foreground-service/   native Android module (keep recording alive)
scripts/          smoke tests (auth, BLE backoff)
docs/             design specs + implementation plans
```

## Prerequisites

- Node 18+ and npm
- A development build is required (this app uses native modules — BLE and the
  foreground service — so it won't run in Expo Go). Use a physical device for
  BLE; an emulator can't talk to the headband.
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
| `EXPO_PUBLIC_DEV_BYPASS` | Optional. `1` shows a "skip login" button (testing only) |

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
| `npm run smoke:auth` | Auth flow smoke test |
| `npm run smoke:backoff` | BLE reconnect/backoff smoke test |

## How a night flows

1. Phone connects to the headband(s) over BLE and streams EEG/EOG, buffered to
   disk by a foreground service.
2. In the morning, the recording uploads to Supabase Storage as resumable
   segments.
3. The Modal backend stages the EEG with YASA and writes a `sessions` row.
4. The app reads that row and renders the hypnogram + score in History.

## License

Private. © Neurex.
