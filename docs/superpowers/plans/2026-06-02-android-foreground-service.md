# Android Foreground Service + Auto-Reconnect Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Android single-device overnight EEG recording survive screen-off, app-backgrounded, and transient BLE drops — keeping the process alive with a `connectedDevice` foreground service and auto-reconnecting + resuming to the same files.

**Architecture:** A local Expo Module (`modules/neurex-foreground-service/`) hosts a hand-rolled Android `connectedDevice` foreground `Service` (no third-party runtime dep, no conflict with `expo-notifications`). A thin JS wrapper (`foregroundService.ts`) no-ops on iOS/Expo Go/web. `streamController.ts` starts/stops the service around a recording and runs a reconnect watchdog with capped backoff; on reconnect it re-runs `startStream` which appends to the existing session files. `real.ts` gains a monotonic-`baseMs` duplicate guard so firmware replay on reconnect can't write dup samples.

**Tech Stack:** Expo SDK 54, React Native 0.81.5 (New Architecture), Kotlin (Expo Modules API), `react-native-ble-plx` ^3.5.1, Zustand, ts-node smoke scripts.

**Spec:** `docs/superpowers/specs/2026-06-02-android-foreground-service-design.md`

**Platform scope:** Android only. iOS background is deferred (see spec) — every change here is a no-op on iOS so the existing `bluetooth-central` wiring is untouched.

---

## File Structure

**Created:**
- `modules/neurex-foreground-service/expo-module.config.json` — Expo module manifest (Android only)
- `modules/neurex-foreground-service/index.ts` — typed JS export
- `modules/neurex-foreground-service/src/NeurexForegroundServiceModule.ts` — `requireNativeModule` wrapper
- `modules/neurex-foreground-service/android/build.gradle` — module gradle
- `modules/neurex-foreground-service/android/src/main/AndroidManifest.xml` — `<service>` declaration
- `modules/neurex-foreground-service/android/src/main/java/expo/modules/neurexforegroundservice/NeurexForegroundServiceModule.kt` — Expo Module (start/stop)
- `modules/neurex-foreground-service/android/src/main/java/expo/modules/neurexforegroundservice/NeurexForegroundService.kt` — the foreground Service
- `src/lib/ble/foregroundService.ts` — platform-safe JS interface (no-op fallback)
- `src/lib/ble/backoff.ts` — pure reconnect-backoff schedule
- `scripts/smoke-backoff.ts` — ts-node assertions for the backoff schedule

**Modified:**
- `src/lib/ble/types.ts` — add `lastBaseMs` to `StreamStats`; add optional `opts` to `ConnectedDevice.startStream`
- `src/lib/ble/real.ts` — track `lastBaseMs`, drop replayed dup packets, honor resume opts
- `src/lib/ble/stub.ts` — match the updated `startStream` signature
- `src/lib/ble/streamController.ts` — start/stop FGS + reconnect watchdog
- `src/screens/home/HomeScreen.tsx` (or the RecordingCard within) — show a "Reconnecting…" state
- `package.json` — add `smoke:backoff` script

> **Note:** `src/state/session.ts` already includes `'reconnecting'` in the `Streaming.connection` union — no change needed there.

---

## Task 1: Scaffold the local Expo Module

Use the official generator for the boilerplate (build.gradle, expo-module.config.json, autolinking), then later tasks replace the generated code with ours. This avoids hand-guessing gradle/config and guarantees autolinking works on SDK 54.

**Files:**
- Create: `modules/neurex-foreground-service/**` (generated)

- [ ] **Step 1: Run the generator**

Run (cwd `C:\Users\Lenovo\neurex-app`):
```powershell
cd "C:\Users\Lenovo\neurex-app"
npx create-expo-module@latest --local neurex-foreground-service
```
When prompted, accept defaults (name `neurex-foreground-service`). This creates `modules/neurex-foreground-service/` with `expo-module.config.json`, `index.ts`, `src/`, `android/`, and (unwanted) `ios/`.

- [ ] **Step 2: Drop the iOS + web boilerplate (Android-only module)**

Run:
```powershell
cd "C:\Users\Lenovo\neurex-app"
Remove-Item -Recurse -Force "modules\neurex-foreground-service\ios" -ErrorAction SilentlyContinue
Remove-Item -Force "modules\neurex-foreground-service\src\*.web.ts" -ErrorAction SilentlyContinue
Get-ChildItem -Recurse "modules\neurex-foreground-service" | Select-Object FullName
```
Expected: a tree under `modules/neurex-foreground-service/` with `android/`, `src/`, `index.ts`, `expo-module.config.json`, and **no** `ios/`.

- [ ] **Step 3: Verify typecheck still passes (generated TS compiles)**

Run:
```powershell
cd "C:\Users\Lenovo\neurex-app"
npm run typecheck
```
Expected: PASS (exit 0). If the generated module references its own `.ios`/view files we deleted, note them — they get replaced in Task 4.

- [ ] **Step 4: Commit the scaffold**

```powershell
cd "C:\Users\Lenovo\neurex-app"
git add modules/neurex-foreground-service
git commit -m "chore(android): scaffold neurex-foreground-service local Expo module"
```

---

## Task 2: Implement the foreground Service (Kotlin)

**Files:**
- Create: `modules/neurex-foreground-service/android/src/main/java/expo/modules/neurexforegroundservice/NeurexForegroundService.kt`

- [ ] **Step 1: Write the Service**

Create the file with exactly:
```kotlin
package expo.modules.neurexforegroundservice

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

class NeurexForegroundService : Service() {
  companion object {
    const val ACTION_START = "expo.modules.neurexforegroundservice.START"
    const val ACTION_STOP = "expo.modules.neurexforegroundservice.STOP"
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"
    const val CHANNEL_ID = "neurex_recording"
    const val NOTIFICATION_ID = 7001
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    when (intent?.action) {
      ACTION_STOP -> {
        stopForegroundCompat()
        stopSelf()
        return START_NOT_STICKY
      }
      else -> {
        val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Neurex"
        val body = intent?.getStringExtra(EXTRA_BODY) ?: "Recording your sleep…"
        startInForeground(title, body)
      }
    }
    // START_STICKY: if the OS kills us under memory pressure, recreate the
    // service. The JS reconnect watchdog re-establishes the BLE stream.
    return START_STICKY
  }

  private fun startInForeground(title: String, body: String) {
    createChannel()
    val notification = buildNotification(title, body)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      // Android 14+ requires the type at startForeground time.
      startForeground(
        NOTIFICATION_ID,
        notification,
        ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE
      )
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        val channel = NotificationChannel(
          CHANNEL_ID,
          "Sleep recording",
          NotificationManager.IMPORTANCE_LOW // no sound, quiet
        ).apply {
          description = "Keeps the EEG recording alive while you sleep."
          setShowBadge(false)
        }
        manager.createNotificationChannel(channel)
      }
    }
  }

  private fun buildNotification(title: String, body: String): Notification {
    // Tapping the notification re-opens the app's launcher activity.
    val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
    val contentIntent = PendingIntent.getActivity(
      this,
      0,
      launchIntent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
    )
    val builder = Notification.Builder(this, CHANNEL_ID)
      .setContentTitle(title)
      .setContentText(body)
      .setSmallIcon(applicationInfo.icon)
      .setOngoing(true)
      .setContentIntent(contentIntent)
    return builder.build()
  }

  private fun stopForegroundCompat() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
  }

  override fun onDestroy() {
    stopForegroundCompat()
    super.onDestroy()
  }
}
```

- [ ] **Step 2: Commit**

```powershell
cd "C:\Users\Lenovo\neurex-app"
git add modules/neurex-foreground-service/android/src/main/java/expo/modules/neurexforegroundservice/NeurexForegroundService.kt
git commit -m "feat(android): connectedDevice foreground service for overnight recording"
```

> No JS test here — native code is verified by the on-device soak in Task 9.

---

## Task 3: Implement the Expo Module (Kotlin) + manifest declaration

**Files:**
- Modify/replace: `modules/neurex-foreground-service/android/src/main/java/expo/modules/neurexforegroundservice/NeurexForegroundServiceModule.kt`
- Modify: `modules/neurex-foreground-service/android/src/main/AndroidManifest.xml`

- [ ] **Step 1: Replace the generated Module Kotlin**

Overwrite `NeurexForegroundServiceModule.kt` with exactly:
```kotlin
package expo.modules.neurexforegroundservice

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class NeurexForegroundServiceModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("NeurexForegroundService")

    Function("start") { title: String, body: String ->
      val context = appContext.reactContext ?: return@Function
      val intent = Intent(context, NeurexForegroundService::class.java).apply {
        action = NeurexForegroundService.ACTION_START
        putExtra(NeurexForegroundService.EXTRA_TITLE, title)
        putExtra(NeurexForegroundService.EXTRA_BODY, body)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    Function("stop") {
      val context = appContext.reactContext ?: return@Function
      val intent = Intent(context, NeurexForegroundService::class.java).apply {
        action = NeurexForegroundService.ACTION_STOP
      }
      context.startService(intent)
    }
  }
}
```

- [ ] **Step 2: Declare the service in the module's AndroidManifest**

Overwrite `modules/neurex-foreground-service/android/src/main/AndroidManifest.xml` with exactly:
```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
  <application>
    <service
      android:name="expo.modules.neurexforegroundservice.NeurexForegroundService"
      android:foregroundServiceType="connectedDevice"
      android:exported="false" />
  </application>
</manifest>
```
Gradle manifest-merging folds this `<service>` into the app manifest. The FGS permissions are already declared in the app's `app.json` (`FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_CONNECTED_DEVICE`).

- [ ] **Step 3: Verify the module's `expo-module.config.json` lists the module class**

Open `modules/neurex-foreground-service/expo-module.config.json`. Confirm it contains (edit to match if the generator named it differently):
```json
{
  "platforms": ["android"],
  "android": {
    "modules": ["expo.modules.neurexforegroundservice.NeurexForegroundServiceModule"]
  }
}
```
Expected: `platforms` is `["android"]` only (we removed iOS), and `modules` points at our Kotlin module class.

- [ ] **Step 4: Commit**

```powershell
cd "C:\Users\Lenovo\neurex-app"
git add modules/neurex-foreground-service/android modules/neurex-foreground-service/expo-module.config.json
git commit -m "feat(android): wire foreground service module (start/stop) + manifest service decl"
```

---

## Task 4: JS interface with platform-safe no-op fallback

**Files:**
- Replace: `modules/neurex-foreground-service/index.ts`
- Create: `modules/neurex-foreground-service/src/NeurexForegroundServiceModule.ts`
- Create: `src/lib/ble/foregroundService.ts`

- [ ] **Step 1: Native module wrapper (resolves to null off-Android)**

Overwrite `modules/neurex-foreground-service/src/NeurexForegroundServiceModule.ts` with exactly:
```ts
import { requireOptionalNativeModule } from 'expo';

export type NeurexForegroundServiceModule = {
  start(title: string, body: string): void;
  stop(): void;
};

// requireOptionalNativeModule returns null when the native module isn't
// present (iOS — module is Android-only; Expo Go; web). Callers must guard.
export default requireOptionalNativeModule<NeurexForegroundServiceModule>(
  'NeurexForegroundService',
);
```

- [ ] **Step 2: Module index**

Overwrite `modules/neurex-foreground-service/index.ts` with exactly:
```ts
export { default as NeurexForegroundServiceModule } from './src/NeurexForegroundServiceModule';
export type { NeurexForegroundServiceModule as NeurexForegroundServiceModuleType } from './src/NeurexForegroundServiceModule';
```

- [ ] **Step 3: App-facing wrapper with no-op fallback**

Create `src/lib/ble/foregroundService.ts` with exactly:
```ts
// Platform-safe wrapper around the Android connectedDevice foreground service.
//
// On iOS / Expo Go / web the native module is absent (requireOptionalNativeModule
// returns null), so both calls become no-ops — call sites never branch on
// platform. iOS background is handled separately (deferred; see spec).

import { NeurexForegroundServiceModule } from '../../../modules/neurex-foreground-service';

const DEFAULT_TITLE = 'Neurex';
const DEFAULT_BODY = 'Recording your sleep…';

export function startForegroundService(opts?: { title?: string; body?: string }): void {
  try {
    NeurexForegroundServiceModule?.start(
      opts?.title ?? DEFAULT_TITLE,
      opts?.body ?? DEFAULT_BODY,
    );
  } catch (e) {
    if (__DEV__) console.warn('[fgs] start failed:', e);
  }
}

export function stopForegroundService(): void {
  try {
    NeurexForegroundServiceModule?.stop();
  } catch (e) {
    if (__DEV__) console.warn('[fgs] stop failed:', e);
  }
}
```

- [ ] **Step 4: Verify typecheck**

Run:
```powershell
cd "C:\Users\Lenovo\neurex-app"
npm run typecheck
```
Expected: PASS (exit 0). If the import path `../../../modules/neurex-foreground-service` doesn't resolve, confirm `tsconfig.json` includes the `modules/` dir (Expo's base tsconfig includes the project root by default).

- [ ] **Step 5: Commit**

```powershell
cd "C:\Users\Lenovo\neurex-app"
git add modules/neurex-foreground-service/index.ts modules/neurex-foreground-service/src/NeurexForegroundServiceModule.ts src/lib/ble/foregroundService.ts
git commit -m "feat(ble): platform-safe foreground-service JS wrapper (no-op off Android)"
```

---

## Task 5: Reconnect backoff schedule (pure fn, TDD)

The project has no jest; it runs assertion scripts via `ts-node` (see `smoke:auth`). We follow that idiom.

**Files:**
- Create: `src/lib/ble/backoff.ts`
- Create: `scripts/smoke-backoff.ts`
- Modify: `package.json` (add `smoke:backoff` script)

- [ ] **Step 1: Write the failing smoke test**

Create `scripts/smoke-backoff.ts` with exactly:
```ts
// Smoke assertions for the reconnect backoff schedule. Run: npm run smoke:backoff
import { nextBackoffMs } from '../src/lib/ble/backoff';

function assertEq(actual: number, expected: number, label: string) {
  if (actual !== expected) {
    console.error(`FAIL ${label}: expected ${expected}, got ${actual}`);
    process.exit(1);
  }
  console.log(`ok ${label} = ${actual}`);
}

// attempt is 1-based: 1st retry waits 2s, doubling, capped at 30s.
assertEq(nextBackoffMs(1), 2000, 'attempt 1');
assertEq(nextBackoffMs(2), 4000, 'attempt 2');
assertEq(nextBackoffMs(3), 8000, 'attempt 3');
assertEq(nextBackoffMs(4), 16000, 'attempt 4');
assertEq(nextBackoffMs(5), 30000, 'attempt 5 capped');
assertEq(nextBackoffMs(99), 30000, 'attempt 99 capped');
assertEq(nextBackoffMs(0), 2000, 'attempt 0 floored to first');

console.log('ALL BACKOFF ASSERTIONS PASSED');
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add to `"scripts"` (after the `"smoke:auth"` line):
```json
    "smoke:backoff": "ts-node --transpile-only scripts/smoke-backoff.ts",
```

- [ ] **Step 3: Run to verify it fails**

Run:
```powershell
cd "C:\Users\Lenovo\neurex-app"
npm run smoke:backoff
```
Expected: FAIL — cannot find module `../src/lib/ble/backoff` (file not yet created).

- [ ] **Step 4: Implement the backoff function**

Create `src/lib/ble/backoff.ts` with exactly:
```ts
// Reconnect backoff schedule for the overnight recording watchdog.
// 1-based attempt: 2s, 4s, 8s, 16s, then steady 30s. Indefinite retries
// (until the user stops the session) are correct for an all-night run.

const BASE_MS = 2000;
const CAP_MS = 30000;

export function nextBackoffMs(attempt: number): number {
  const n = attempt < 1 ? 1 : attempt;
  const ms = BASE_MS * 2 ** (n - 1);
  return ms > CAP_MS ? CAP_MS : ms;
}
```

- [ ] **Step 5: Run to verify it passes**

Run:
```powershell
cd "C:\Users\Lenovo\neurex-app"
npm run smoke:backoff
```
Expected: PASS — `ALL BACKOFF ASSERTIONS PASSED`, exit 0.

- [ ] **Step 6: Commit**

```powershell
cd "C:\Users\Lenovo\neurex-app"
git add src/lib/ble/backoff.ts scripts/smoke-backoff.ts package.json
git commit -m "feat(ble): reconnect backoff schedule + smoke test"
```

---

## Task 6: Duplicate guard + resume support in the BLE layer

Thread `lastBaseMs` so a resumed `startStream` skips firmware-replayed packets already written before a drop.

**Files:**
- Modify: `src/lib/ble/types.ts`
- Modify: `src/lib/ble/real.ts`
- Modify: `src/lib/ble/stub.ts`

- [ ] **Step 1: Extend the types**

In `src/lib/ble/types.ts`, add `lastBaseMs` to `StreamStats`:
```ts
export type StreamStats = {
  packets: number;
  samples: number;
  /** Packets dropped due to bad markers / bad checksum / seq gap. */
  drops: number;
  /** Packets skipped as duplicates on resume (baseMs <= lastBaseMs). */
  dupSkips: number;
  lastSeq: number | null;
  generation: number;
  /** Highest packet baseMs written so far — used to dedup on resume. null until first write. */
  lastBaseMs: number | null;
};
```
And change the `ConnectedDevice.startStream` signature to accept resume options:
```ts
export type StreamResumeOpts = {
  /** On reconnect, drop replayed packets with baseMs <= this value. */
  resumeFromBaseMs?: number | null;
};

export type ConnectedDevice = {
  deviceId: string;
  startStream(
    sessionId: string,
    cb: StreamCallbacks,
    opts?: StreamResumeOpts,
  ): Promise<StreamHandle>;
  startPreview(cb: PreviewCallbacks): Promise<PreviewHandle>;
  disconnect(): Promise<void>;
};
```

- [ ] **Step 2: Honor the guard in real.ts**

In `src/lib/ble/real.ts`, change the `startStream` signature and the stats init. Replace the method header:
```ts
      async startStream(
        sessionId: string,
        cb: StreamCallbacks,
        opts?: import('./types').StreamResumeOpts,
      ): Promise<StreamHandle> {
```
Replace the `const stats: StreamStats = { ... }` initializer with:
```ts
        const stats: StreamStats = {
          packets: 0,
          samples: 0,
          drops: 0,
          dupSkips: 0,
          lastSeq: null,
          generation: 0,
          lastBaseMs: opts?.resumeFromBaseMs ?? null,
        };
```
Then, inside `onValue`, immediately after `const pkt = result.packet;` and BEFORE the gap/generation bookkeeping, insert the dedup guard:
```ts
          // Resume dedup: firmware replays un-ACKed packets on reconnect.
          // Drop any whose baseMs we've already written so files stay
          // monotonic. baseMs is uint32 ms-since-boot — no overnight wrap.
          if (stats.lastBaseMs !== null && pkt.baseMs <= stats.lastBaseMs) {
            stats.dupSkips++;
            cb.onPacket?.(pkt, stats);
            return;
          }
```
And after the existing `stats.samples += SAMPLES_PER_PACKET;` line, record the high-water mark:
```ts
          stats.lastBaseMs = pkt.baseMs;
```

- [ ] **Step 3: Match the signature in stub.ts**

In `src/lib/ble/stub.ts`, update the `startStream` signature to accept (and ignore) the new opts, and add `dupSkips: 0` + `lastBaseMs: null` to any `StreamStats` literal it builds. Open the file and:
- Change `startStream(sessionId: string, cb: StreamCallbacks)` to `startStream(sessionId: string, cb: StreamCallbacks, _opts?: import('./types').StreamResumeOpts)`.
- Add `dupSkips: 0,` and `lastBaseMs: null,` to its `stats` object literal(s).

- [ ] **Step 4: Verify typecheck**

Run:
```powershell
cd "C:\Users\Lenovo\neurex-app"
npm run typecheck
```
Expected: PASS. If `multiController.ts` or any caller builds a `StreamStats` literal, add the two new fields there too until typecheck is clean.

- [ ] **Step 5: Commit**

```powershell
cd "C:\Users\Lenovo\neurex-app"
git add src/lib/ble/types.ts src/lib/ble/real.ts src/lib/ble/stub.ts
git commit -m "feat(ble): monotonic-baseMs dedup guard + resume opts for reconnect"
```

---

## Task 7: Foreground service + reconnect watchdog in streamController

**Files:**
- Modify: `src/lib/ble/streamController.ts`

- [ ] **Step 1: Add imports**

At the top of `src/lib/ble/streamController.ts`, add:
```ts
import { getBleManager } from './manager';
import { startForegroundService, stopForegroundService } from './foregroundService';
import { nextBackoffMs } from './backoff';
import type { Subscription } from 'react-native-ble-plx';
```

- [ ] **Step 2: Extend the ActiveSession record**

Replace the `type ActiveSession = { ... }` block with:
```ts
type ActiveSession = {
  sessionId: string;
  deviceId: string;
  handle: StreamHandle;
  device: ConnectedDevice;
  statsTimer: ReturnType<typeof setInterval>;
  cb: StreamCallbacks;
  // Holder, not a snapshot: real.ts allocates a fresh StreamStats object on
  // each (re)startStream, so we track the current one by reference here. The
  // stats timer and the reconnect loop both read statsRef.current.
  statsRef: { current: StreamStats };
  disconnectSub: Subscription | null;
  userStopped: boolean;
  reconnecting: boolean;
};
```
You will also need `StreamCallbacks` in the type imports — add it to the existing `import type { ... } from './types';` line.

- [ ] **Step 3: Refactor startSession to register the watchdog + FGS**

Replace the whole `startSession` function with:
```ts
export async function startSession(deviceId: string): Promise<{ sessionId: string }> {
  if (active) return { sessionId: active.sessionId };

  const sessionId = generateSessionId();
  const device = await bleClient.connect(deviceId);

  const statsRef: { current: StreamStats } = {
    current: {
      packets: 0,
      samples: 0,
      drops: 0,
      dupSkips: 0,
      lastSeq: null,
      generation: 0,
      lastBaseMs: null,
    },
  };

  const cb: StreamCallbacks = {
    onPacket: (_pkt, stats) => {
      statsRef.current = stats;
    },
    onDrop: (_reason, stats) => {
      statsRef.current = stats;
    },
    onError: (err) => {
      if (__DEV__) console.warn('[stream] error:', err.message);
      // Don't flip to 'lost' here — the disconnect listener owns recovery.
    },
  };

  const handle = await device.startStream(sessionId, cb);

  useSession.getState().setStreaming({
    sessionId,
    startedAtMs: Date.now(),
    packets: 0,
    samples: 0,
    drops: 0,
    lastSeq: null,
    generation: 0,
    connection: 'connected',
  });

  const statsTimer = setInterval(() => {
    const s = statsRef.current;
    useSession.getState().patchStreaming({
      packets: s.packets,
      samples: s.samples,
      drops: s.drops,
      lastSeq: s.lastSeq,
      generation: s.generation,
    });
  }, 500);

  // Keep the process alive overnight (screen off / backgrounded).
  startForegroundService();

  active = {
    sessionId,
    deviceId,
    handle,
    device,
    statsTimer,
    cb,
    statsRef,
    disconnectSub: null,
    userStopped: false,
    reconnecting: false,
  };

  registerDisconnectWatch();

  return { sessionId };
}
```

- [ ] **Step 4: Add the disconnect watcher + reconnect loop**

Immediately after `startSession`, add:
```ts
function registerDisconnectWatch(): void {
  if (!active) return;
  const manager = getBleManager();
  if (!manager) return; // stub / Expo Go — no native disconnect events
  const session = active;
  session.disconnectSub?.remove();
  session.disconnectSub = manager.onDeviceDisconnected(session.deviceId, () => {
    if (!active || active.sessionId !== session.sessionId) return;
    if (active.userStopped || active.reconnecting) return;
    void reconnectLoop();
  });
}

async function reconnectLoop(): Promise<void> {
  if (!active || active.reconnecting || active.userStopped) return;
  active.reconnecting = true;
  useSession.getState().patchStreaming({ connection: 'reconnecting' });

  let attempt = 0;
  while (active && !active.userStopped) {
    attempt++;
    try {
      // Tear down the dead stream handle before re-subscribing so we don't
      // leak the old characteristic monitor / ACK timer.
      await active.handle.stop().catch(() => undefined);

      const device = await bleClient.connect(active.deviceId);
      const resumeFromBaseMs = active.statsRef.current.lastBaseMs ?? null;
      const handle = await device.startStream(active.sessionId, active.cb, {
        resumeFromBaseMs,
      });

      active.device = device;
      active.handle = handle;
      active.reconnecting = false;
      useSession.getState().patchStreaming({ connection: 'connected' });
      registerDisconnectWatch(); // re-arm for the new connection
      if (__DEV__) console.log(`[stream] reconnected after ${attempt} attempt(s)`);
      return;
    } catch (e) {
      const waitMs = nextBackoffMs(attempt);
      if (__DEV__) {
        console.warn(`[stream] reconnect attempt ${attempt} failed; retry in ${waitMs}ms`, e);
      }
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  // Loop exited because the user stopped — leave state to stopSession.
}
```

- [ ] **Step 5: Update stopSession to tear down the watchdog + FGS**

Replace the whole `stopSession` function with:
```ts
export async function stopSession(): Promise<StopResult | null> {
  if (!active) return null;
  const session = active;
  active.userStopped = true;
  active = null;

  session.disconnectSub?.remove();
  clearInterval(session.statsTimer);
  const stats = await session.handle.stop().catch(() => session.statsRef.current);
  await session.device.disconnect().catch(() => undefined);

  stopForegroundService();
  useSession.getState().setStreaming(null);

  return {
    sessionId: session.sessionId,
    sessionDir: session.handle.sessionDir,
    eegUri: session.handle.eegUri,
    eogUri: session.handle.eogUri,
    stats,
  };
}
```

- [ ] **Step 6: Verify typecheck**

Run:
```powershell
cd "C:\Users\Lenovo\neurex-app"
npm run typecheck
```
Expected: PASS. Resolve any unused-import or type errors (e.g. ensure `StreamCallbacks` and `StreamStats` are imported from `./types`).

- [ ] **Step 7: Commit**

```powershell
cd "C:\Users\Lenovo\neurex-app"
git add src/lib/ble/streamController.ts
git commit -m "feat(ble): foreground service + indefinite reconnect-and-resume watchdog"
```

---

## Task 8: Surface "Reconnecting…" in the UI

**Files:**
- Modify: the recording status UI (locate with the grep below — likely `src/screens/home/HomeScreen.tsx`)

- [ ] **Step 1: Find where `connection` is rendered**

Run:
```powershell
cd "C:\Users\Lenovo\neurex-app"
Select-String -Path "src\**\*.tsx" -Pattern "connection" -SimpleMatch
```
Expected: one or more hits where `streaming.connection` drives a label/pill (Home recording card). Note the file + line.

- [ ] **Step 2: Add a reconnecting branch**

In the component that renders the recording status, add a `'reconnecting'` case that shows a clear, calm label — e.g. a `StatusPill` (already in `src/components/StatusPill.tsx`) reading **"Reconnecting…"**. Match the existing render style; example pattern:
```tsx
const label =
  streaming.connection === 'connected'
    ? 'Recording'
    : streaming.connection === 'reconnecting'
      ? 'Reconnecting…'
      : 'Connection lost';
```
Use the same component/props the file already uses for the connected/lost states — do not introduce a new styling system.

- [ ] **Step 3: Verify typecheck**

Run:
```powershell
cd "C:\Users\Lenovo\neurex-app"
npm run typecheck
```
Expected: PASS.

- [ ] **Step 4: Commit**

```powershell
cd "C:\Users\Lenovo\neurex-app"
git add -- src/screens/home
git commit -m "feat(ui): show Reconnecting… state during overnight BLE recovery"
```

---

## Task 9: Build a preview APK + on-device soak verification

This is the verification bar before any unattended overnight (project standing rule: 30-min soak, wiped state). It is NOT a code task — it is the acceptance gate.

**Files:** none (build + manual verification)

- [ ] **Step 1: Final full typecheck + backoff smoke**

Run:
```powershell
cd "C:\Users\Lenovo\neurex-app"
npm run typecheck
npm run smoke:backoff
```
Expected: both exit 0.

- [ ] **Step 2: Build the standalone preview APK**

Run:
```powershell
cd "C:\Users\Lenovo\neurex-app"
npx eas-cli build --platform android --profile preview
```
Expected: EAS prebuilds (the local module autolinks; the `<service>` lands in the merged manifest), builds, and returns an install URL/QR. Install on the target Android phone.

- [ ] **Step 3: Soak test (≥30–60 min)** — verify on-device:
  - Start a recording. Confirm the ongoing **"Recording your sleep…"** notification appears.
  - Turn the screen off and background the app. Wait ≥20 min.
  - Force a disconnect: walk the headband out of BLE range ~20–30 s, then return.
  - Confirm the UI shows **Reconnecting…** then **Recording** again, and the FGS notification never disappeared.
  - Stop the recording. Confirm the notification is removed and a file was saved.

- [ ] **Step 4: Validate the capture with the analysis tools (algorithms repo)**

Pull the saved `EEG.BIN` off the phone, then in the **`Neurex algoritmai`** repo run QC (do NOT modify that repo — read-only validation):
```powershell
cd "C:\Users\Lenovo\Neurex algoritmai"
py tools\analysis\neurex_qc.py <path-to-soak>\EEG.BIN
```
Expected: monotonic timeline across the disconnect gap; `dup ≈ 0`; loss bounded by (gap − firmware replay). Record the numbers in the session notes.

- [ ] **Step 5: Mark the feature verified**

Only after Steps 3–4 pass on a real device, update the spec status to "Implemented + soak-verified (<date>)" and note the soak numbers. If the soak fails (process death, notification vanished, dups in file), open systematic-debugging before declaring done.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- §1 native FGS → Tasks 1–3. §2 JS interface → Task 4. §3 reconnect watchdog → Tasks 5 (backoff) + 7. §4 dup guard → Task 6. §5 session state → already present (noted) + Task 8 UI. §6 permissions → relies on existing onboarding grant + manifest (Task 3); FGS start tolerant if notifications denied. §7 build/soak → Task 9. iOS deferred → enforced by no-op wrapper (Task 4) and Android-only module (`platforms: ["android"]`, Task 3). ✅ All sections mapped.

**Placeholder scan:** No TBD/TODO; every code step shows full code. The one "locate the file" step (Task 8) gives the exact grep + the exact code pattern to add. ✅

**Type consistency:** `StreamStats` gains `dupSkips` + `lastBaseMs` in Task 6 and every literal (real.ts, stub.ts, streamController.ts `latest`) is updated to include them. `startStream` third param `StreamResumeOpts` defined in Task 6 and consumed in Task 7. `nextBackoffMs` defined Task 5, used Task 7. `startForegroundService`/`stopForegroundService` defined Task 4, used Task 7. Native `start(title, body)`/`stop()` consistent across Kotlin (Task 3) and TS wrapper (Task 4). ✅
