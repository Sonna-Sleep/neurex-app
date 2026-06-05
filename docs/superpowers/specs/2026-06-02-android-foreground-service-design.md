# Android Foreground Service + Auto-Reconnect for Overnight EEG — Design

**Date:** 2026-06-02
**Repo:** `neurex-app` (branch `feat/finish-ble-streaming`)
**Status:** Approved (design); ready for implementation plan
**Platform scope:** Android only for this work. iOS background is explicitly
**deferred, not dropped** — see "iOS (deferred)" below.

---

## Problem

Overnight single-device EEG recording must survive (a) the screen turning off,
(b) the app being backgrounded, and (c) transient BLE disconnects (roll-over,
phone drift) — all without a laptop running Metro.

Today recording lives in a module-level closure in `streamController.ts` and is
kept alive only by `expo-keep-awake` (screen stays on). `react-native-ble-plx`
ships **no** foreground service, so Android will suspend the BLE stream once the
app is backgrounded, and a single disconnect ends the session silently (the
`onError` callback sets `connection: 'lost'` and nothing recovers).

## Goal

A daytime-soak-verified path where Android single-device recording keeps running
with the screen off and the app backgrounded, auto-reconnects after a BLE drop,
and resumes writing to the **same** session files with near-zero loss and zero
duplicate samples.

## Non-goals (out of scope for this work)

- **iOS background** — blocked on Apple Developer Program enrollment and the
  firmware GATT chunk spec. Deferred deliberately. The native module is
  Android-only and the JS layer no-ops on iOS, so the existing iOS
  `UIBackgroundModes` / `bluetooth-central` wiring is untouched and ready.
- **Dual-record foreground service** — single-device first. The FGS interface is
  built to be reusable so the dual-record path can adopt it later without an API
  change.
- **Cloud upload pipeline** changes.

---

## Verified facts (web research, June 2026)

- The correct service type for holding a BLE link is
  `foregroundServiceType="connectedDevice"`.
- **Android 15's 6-hour-per-24h FGS runtime cap applies only to `dataSync` and
  `mediaProcessing`, NOT `connectedDevice`** — so a `connectedDevice` service
  survives a full night without `Service.onTimeout()` killing it. This is the
  decisive reason to use `connectedDevice` (not `dataSync`).
- `react-native-ble-plx` provides no foreground service; `isBackgroundEnabled`
  only adds background plumbing. An external FGS must keep the process up.
- Plugging in overnight (the project's standing wall-charger rule) sidesteps
  Android Doze entirely, so we avoid the Play-review-risky
  `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` permission.
- Required manifest permissions (already present in `app.json`):
  `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`,
  `BLUETOOTH_CONNECT`, `POST_NOTIFICATIONS`. Runtime prerequisite for starting a
  `connectedDevice` FGS: `BLUETOOTH_CONNECT` granted (it is, via pairing).

Sources: developer.android.com FGS service-types, Android 14 fgs-types-required,
Android 15 behavior-changes; react-native-ble-plx GitHub; Android Doze docs.

## Approach decision

Chosen: **hand-rolled native foreground service, packaged as a local Expo
Module.** Rejected alternatives: `react-native-notify-kit` (adds a second full
notification stack beside `expo-notifications`; single-maintainer fork) and
swapping to `@sfourdrinier/react-native-ble-plx` (replaces the proven core BLE
library). A local Expo Module is the cleanest New-Architecture-compatible host:
one unit contributes both the merged `AndroidManifest.xml` service declaration
and the native code, no third-party runtime dependency, no notification
conflict, and full lifecycle control — appropriate for a medical-adjacent
overnight recorder.

---

## Architecture

### 1. Native foreground service — local Expo Module `modules/neurex-foreground-service/`

A local Expo Module (autolinked by Expo SDK 54) containing:

- `android/.../NeurexForegroundService.kt` — a started `Service`. On START:
  creates a low-importance, non-dismissable notification channel
  (`neurex_recording`), builds an ongoing "Recording your sleep…" notification
  (no sound/vibration), and calls
  `startForeground(NOTIF_ID, notification, FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)`.
  On STOP: `stopForeground(STOP_FOREGROUND_REMOVE)` + `stopSelf()`. Tapping the
  notification opens the app (content `PendingIntent` to the main activity).
- `android/.../NeurexForegroundServiceModule.kt` — Expo Module exposing
  `start(title: String, body: String)` and `stop()` to JS.
- `android/src/main/AndroidManifest.xml` — declares
  `<service android:name=".NeurexForegroundService"
  android:foregroundServiceType="connectedDevice" android:exported="false"/>`
  (Gradle merges it into the app manifest).
- `expo-module.config.json`, `index.ts` — module config + typed JS surface.
- **iOS:** no `ios/` implementation. The module resolves to undefined on iOS and
  the JS wrapper no-ops there.

### 2. JS interface — `src/lib/ble/foregroundService.ts`

Thin, platform-safe wrapper:

```ts
startForegroundService(opts?: { title?: string; body?: string }): void
stopForegroundService(): void
```

`requireOptionalNativeModule`-style guard: if the native module is absent
(Expo Go, iOS, web), both functions become no-ops (dev/typecheck never crash).
Call sites never branch on platform.

### 3. Reconnect watchdog — `src/lib/ble/streamController.ts`

- `startSession(deviceId)`: connect → `startStream(sessionId, cb)` →
  `startForegroundService()` → register
  `manager.onDeviceDisconnected(deviceId, handler)`. Store the listener
  subscription and a `userStopped` flag in the `ActiveSession` record.
- **Disconnect handler** (fires when session active AND not user-stopped):
  - `useSession.patchStreaming({ connection: 'reconnecting' })`.
  - Reconnect loop with capped exponential backoff: 2s → 4s → 8s → 16s → 30s
    (then steady 30s), **indefinite until `stopSession()`** — correct for an
    all-night run. Each attempt: `manager.connectToDevice(deviceId, {autoConnect:true})`
    → `requestMTU` → `discoverAllServicesAndCharacteristics`.
  - On success: re-run `device.startStream(sessionId, cb)`. Because
    `AppendingFile.open()` seeks to `handle.size`, this **appends to the same
    EEG.BIN/EOG.BIN**. Set `connection: 'connected'`. Re-register the disconnect
    listener for the new connection.
  - FGS stays running throughout — the process must not be reclaimed mid-gap.
- `stopSession()`: set `userStopped = true` → remove disconnect listener → stop
  stream → disconnect → **`stopForegroundService()`** → clear state.

### 4. Duplicate guard on resume — `src/lib/ble/real.ts`

The firmware replays un-ACKed packets on reconnect (existing `ContigTracker` +
`NEUREX_ACK_WRITE_UUID` path), which recovers loss but can re-deliver a few
packets that were already written before the drop. To keep files monotonic and
dup-free:

- Track `lastBaseMs` across `startStream` invocations for a session (persisted at
  the session level, not the per-stream closure, so it survives a resume).
- In `onValue`, after parsing, drop any packet whose `baseMs <= lastBaseMs`
  (count it as a dedup-skip stat, not a drop). Otherwise update `lastBaseMs` and
  write. `baseMs` is uint32 ms-since-boot → no overnight wrap (wraps at ~49.7
  days). Mirrors `tools/capture/ble_stream_recv.py` timestamp dedup.

Implementation note: `lastBaseMs` must outlive a single `startStream` closure.
It is threaded via the `ActiveSession`/`StreamHandle` so a resumed stream
continues from the last written timestamp.

### 5. Session state — `src/state/session.ts`

- Add `'reconnecting'` to the `connection` union (currently
  `'connected' | 'lost'`).
- Home `RecordingCard` shows a small "Reconnecting…" pill when in that state.
- Optional dedup-skip counter surfaced alongside drops in stats (nice-to-have;
  honors the project's "never silent-drop" rule by making replay-dedups visible).

### 6. Permissions / lifecycle guards

- Guard `startForegroundService()` behind a `POST_NOTIFICATIONS` runtime check
  (Android 13+); onboarding `NotificationsPermission.tsx` already requests it. If
  not granted, the service can still start but without a visible notification on
  some OEMs — so we request/verify before recording.
- `BLUETOOTH_CONNECT` already granted via pairing — the runtime prerequisite for
  a `connectedDevice` FGS.
- No `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` — rely on plugged-in overnight.

### 7. Build & verification (the "+B" preview build)

- Standalone APK: `npx eas-cli build --platform android --profile preview`.
- **Daytime soak (≥30–60 min)** — the bar before any unattended overnight:
  - Start a recording, turn the screen off, background the app.
  - Force a disconnect (walk out of BLE range ~20–30s), return.
  - Verify: FGS notification persists the whole time; `connection` goes
    `connected → reconnecting → connected`; EEG.BIN grows continuously across the
    gap; post-hoc QC shows monotonic timeline, dup ≈ 0, loss bounded by the gap
    minus firmware replay.
  - Confirm no process death / ANR; app returns to a live session on foreground.

---

## iOS (deferred — DO NOT FORGET)

Tracked as the next platform after Apple Developer Program enrollment + firmware
GATT chunk spec. The Android work here intentionally leaves iOS untouched:

- `app.json` iOS `UIBackgroundModes` (`bluetooth-central`, `fetch`, `processing`)
  unchanged.
- `wakeHandler.ts` iOS state-restoration stub unchanged.
- The `foregroundService.ts` interface no-ops on iOS, so iOS recording behaves
  exactly as today until the iOS background-pull work lands.

---

## Testing strategy

- `npm run typecheck` clean.
- Extract the reconnect backoff schedule as a pure function and unit-test it
  (sequence + cap), since the native/BLE paths can't be unit-tested in JS.
- Native + reconnect behavior verified by the on-device daytime soak above
  (the project's standing 30-minute-soak verification bar).

## Risks

- OEM power management can still throttle a backgrounded process on some phones;
  plugged-in overnight + `connectedDevice` FGS is the mitigation. Soak on the
  actual target phone.
- New-Architecture compatibility of the Expo Module must be confirmed in the
  prebuild/dev build (`newArchEnabled: true`) — config/native-only modules are
  arch-agnostic, but verify before trusting overnight.
- A resume that re-runs `startStream` must not double-register characteristic
  monitors or ACK timers — the old `StreamHandle.stop()` must run before the new
  `startStream` on each reconnect.
