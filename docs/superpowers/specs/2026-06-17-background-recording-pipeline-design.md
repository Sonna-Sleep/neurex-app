# Background Recording Pipeline — Design (3 features)

**Date:** 2026-06-17 · **Repo:** neurex-app (+ neurex-backend) · **Platforms:** iOS + Android
**Status:** approved (iOS Live Activity = yes; all 3 sequenced). Encryption = Phase 2 (deferred).

Grounded in platform research (June 2026, Expo SDK 54 / RN 0.81 / Hermes). Force-quit out of scope.

## Hard platform truths (drive the architecture)
- `setInterval` does NOT survive backgrounding → the 30-min cycle is **native-driven on Android** (inside the `connectedDevice` FGS) and **BLE-packet-driven on iOS** ("≥30 min of samples buffered → upload"), with `BGProcessingTask` as a catch-up net.
- An iOS plain notification **cannot tick** → live timer needs a **Live Activity** (ActivityKit widget). Android notification ticks free via the OS chronometer.
- iOS background uploads need the **legacy `expo-file-system` BACKGROUND `URLSession`** (new API drops to foreground); it auto-retries through outages (passes the airplane-mode test). Android: the live FGS keeps `expo/fetch` uploads completing; a persistent queue + `expo-background-task`/WorkManager is the durability net.
- Android FGS type MUST be `connectedDevice` (uncapped; `dataSync` hits a 6h cap on Android 15+).
- iOS Live Activity hard-ends at 8h (12h total) → re-start across the night with the original start date.

## Feature 1 — live "Recording — Xh Ym"
- **Android:** add `setWhen(startMs)` + `setUsesChronometer(true)` + `setShowWhen(true)` to the existing native FGS notification (`modules/neurex-foreground-service`). OS ticks it, zero JS, backgrounded. Tap-to-reopen via existing `expo-notifications` response listeners → route to the active session.
- **iOS:** Live Activity via `@bacons/apple-targets` (`create-target widget`) — a Widget Extension + SwiftUI `Text(timerInterval:)` (OS-rendered ticking) + `NSSupportsLiveActivities`; a thin native bridge `start/update/end`; restart at the ~8h boundary. Verified later on TestFlight (no iPhone locally).

## Feature 2 — 30-min chunked upload during recording
- **Rolling local chunks:** BLE callback appends to a rolling on-disk chunk; at ≥30 min → finalize + enqueue. Lossless (byte-offset boundaries; ordered concat reproduces the night). Recording never pauses (append-to-disk independent of upload). App-side only; no device/SD changes.
- **Driver:** Android native loop in the FGS (`react-native-background-actions` or native alarm + Headless JS); iOS BLE-packet-driven trigger (+ `BGProcessingTask` catch-up).
- **Confirm-then-delete:** upload/finalize verifies the assembled RAW.BIN stream by byte count and SHA-256 before local delete. Storage uses `{prefix}/segments/raw/segNNNN.bin`; there is no EEG fallback stream.
- **Offline:** persistent on-disk queue; iOS background `URLSession` + Android queue/WorkManager auto-retry on reconnect. Never delete local before server confirm.
- **Backend:** the ingest endpoint persists each chunk to Storage at the session prefix (so the existing reconcile/assemble/stage path produces the night). Returns the byte count.

## Feature 3 — auto-stop on device off / battery dead
- **Graceful:** subscribe to / poll the battery char `0x2A19`; at ≤ `BATTERY_STOP_PCT` (default 5%) → finalize + stop.
- **Abrupt:** link lost and unrecoverable for `DEVICE_ABANDONED_MS` (default 10 min) → finalize + stop (vs today's forever-retry).
- Both call the finalize/teardown path (stop stream + disconnect + FGS off + clear state); the captured data uploads via F2 (incremental) and/or the existing recovery path. Tunable thresholds.

## New dependencies / native pieces
- Android: 3 lines on the FGS notification (no dep); a native 30-min loop driver (`react-native-background-actions`, vet) ; `expo-background-task` for retry.
- iOS: `@bacons/apple-targets` (Live Activity widget) ; `expo-file-system/legacy` (background URLSession).
- Backend: a Modal `@modal.fastapi_endpoint` ingest function.

## Testability
- Android phone is connected here → F3, F1-Android, F2 (Android path) + the Modal endpoint are testable now.
- iOS-only (Live Activity, legacy background URLSession) → built now, verified on TestFlight later.
- Pure logic (chunker, queue, confirm-compare, battery/abandon rules) → unit/smoke tested.

## Build order
F3 (auto-stop) → F1-Android (chronometer) → F2 (chunker + queue + Modal ingest + confirm-delete + drivers) → F1-iOS (Live Activity). Each verified as it lands; commit per sub-feature; ask before pushing.

## Acceptance criteria (restated)
8h backgrounded → all data in cloud; airplane-mode 2h → auto-resume, night complete; storage drops after confirmed delete; recording never interrupted; device off/dead → recording stops.
