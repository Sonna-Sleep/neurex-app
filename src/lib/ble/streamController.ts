// Orchestrates a single live recording session:
//   start  → bleClient.connect → device.startStream(...)  + push live state to Zustand
//   stop   → handle.stop() → device.disconnect() → return file URIs for upload
//
// Module-level state (active session) is deliberate — the StreamHandle is a
// closure that must outlive the React component that started the stream (the
// user can navigate away from the recording screen mid-session). A durable
// marker + a self-describing meta.json (see ../cloud/recovery) let an app
// restart recover the night even though THIS module's state is in-memory.

import { bleClient } from './index';
import { batteryShouldStop, DEVICE_ABANDONED_MS } from './autoStop';
import type { ConnectedDevice, StreamHandle, StreamStats, StreamCallbacks } from './types';
import { useSession } from '../../state/session';
import { getBleManager } from './manager';
import {
  ensureBatteryOptimizationExemption,
  startForegroundService,
  stopForegroundService,
} from './foregroundService';
import { nextBackoffMs } from './backoff';
import {
  WATCHDOG_INTERVAL_MS,
  freshWatchdogState,
  stallTick,
} from './watchdog';
import {
  setActiveRecording,
  clearActiveRecording,
  writeSessionMeta,
  type RecordingMeta,
} from '../cloud/recovery';
import {
  drainChunks,
  enqueueSegment,
  startChunkDriver,
  stopChunkDriver,
} from '../cloud/chunkDriver';
import { notifyDeviceDisconnected, notifyRecordingStopped } from '../notifications/local';
import { checkDiskSpace, InsufficientStorageError } from './diskSpace';
import type { Subscription } from 'react-native-ble-plx';
import { EEG_SAMPLE_RATE_HZ } from './constants';
import { transmitSession } from '../cloud/cloudSync';
import {
  writeStreamStatsSidecar,
  type StreamStatsStopReason,
} from '../cloud/streamStatsSidecar';

// User-initiated session start: time-bounded so a device that's off or out of
// range fails fast with an error instead of an infinite spinner. The background
// reconnect loop deliberately omits this.
const CONNECT_TIMEOUT_MS = 20_000;
// How long a reconnect may drag on before the UI escalates to "connection
// lost". Retries continue indefinitely (correct for an overnight run — the
// device may return); this just stops pretending a long outage is a brief blip.
const LOST_AFTER_MS = 90_000;

// Thrown pre-flight (before any data is written) when the connected headband
// reports variant_known === 0 — the firmware didn't recognize this board and is
// running default settings whose channel/BIAS may be wrong, so the recording
// can rail. Caught by the start-session caller (RecordingCard) and shown as a
// prominent warning. The message is the user-facing text — keep it plain.
export class UnconfiguredDeviceError extends Error {
  constructor() {
    super(
      "This headband isn’t set up for recording yet — it’s running default " +
        'settings, so the brain signal may be wrong or completely flat (railed). ' +
        'Don’t record tonight: this board needs to be added to the firmware first. ' +
        'Contact Neurex support with your device so we can configure it.',
    );
    this.name = 'UnconfiguredDeviceError';
  }
}

type StatsRef = { current: StreamStats };

type ActiveSession = {
  sessionId: string;
  startedAtMs: number;
  deviceId: string;
  meta: RecordingMeta;
  handle: StreamHandle;
  device: ConnectedDevice;
  statsTimer: ReturnType<typeof setInterval>;
  // Level-based data-stall watchdog. Forces a reconnect when packets stop
  // arriving while the link still reports connected (firmware hang). Always a
  // live interval while recording (a no-op tick on the stub/Expo-Go path);
  // nulled out by failSession after a fatal storage error.
  watchdogTimer: ReturnType<typeof setInterval> | null;
  cb: StreamCallbacks;
  // Holder, not a snapshot: real.ts allocates a fresh StreamStats object on
  // each (re)startStream, so we track the current one by reference here. The
  // stats timer and the reconnect loop both read statsRef.current.
  statsRef: StatsRef;
  disconnectSub: Subscription | null;
  // Escalates the UI to 'lost' if a reconnect drags past LOST_AFTER_MS.
  lostTimer: ReturnType<typeof setTimeout> | null;
  // Auto-ends the night if a reconnect can't recover within DEVICE_ABANDONED_MS
  // (device powered off / dead) — vs retrying forever. (Feature 3.)
  abandonTimer: ReturnType<typeof setTimeout> | null;
  // Unsubscribe for the battery-level watcher that auto-ends on low battery.
  batteryUnsub: (() => void) | null;
  userStopped: boolean;
  reconnecting: boolean;
  terminalReason: StreamStatsStopReason | null;
};

let active: ActiveSession | null = null;
// Set SYNCHRONOUSLY at the top of resumeSessionAfterRestore — before the slow
// BLE connect await — so a concurrent launch-time recoverAll can exclude the
// session being restored even though `active`/`streaming` aren't set until the
// connect + startStream finish. Cleared when the resume settles.
let restoringSessionId: string | null = null;

export function isSessionActive(): boolean {
  return active !== null;
}

/** The session id that must NOT be touched by crash-recovery: the live one, or
 * one currently being resumed from iOS state restoration. Read by recovery.ts
 * (via dynamic import, to avoid the static cycle) to skip it during a sweep. */
export function activeOrRestoringSessionId(): string | null {
  return active?.sessionId ?? restoringSessionId;
}

function freshStats(): StreamStats {
  return {
    packets: 0,
    samples: 0,
    drops: 0,
    dupSkips: 0,
    lastSeq: null,
    generation: 0,
    lastBaseMs: null,
    deviceReboots: 0,
  };
}

function endMsFromSamples(startedAtMs: number, stats: StreamStats): number {
  return startedAtMs + Math.round((stats.samples / EEG_SAMPLE_RATE_HZ) * 1000);
}

function makeCallbacks(statsRef: StatsRef): StreamCallbacks {
  return {
    onPacket: (_pkt, stats) => {
      statsRef.current = stats;
    },
    onDrop: (_reason, stats) => {
      statsRef.current = stats;
    },
    onError: (err) => {
      handleStreamError(err);
    },
    // A recording segment rolled (or the final one flushed on stop) — hash it,
    // queue it, and upload it to /ingest (Feature 2). No-op unless chunked upload
    // is enabled. Fire-and-forget: the queue is durable, so a failure here just
    // leaves the segment on disk for the next drain / launch-time recovery.
    onSegmentClosed: (seg) => {
      void enqueueSegment(seg);
    },
  };
}

// A fatal storage error (disk full / I/O) is the ONE stream error that needs
// to stop the session — a disconnect, by contrast, is owned by the reconnect
// watcher. Anything else is logged and left to that watcher.
function handleStreamError(err: Error): void {
  if (err?.name === 'StorageWriteError') {
    void failSession(err.message);
    return;
  }
  if (__DEV__) console.warn('[stream] error:', err.message);
}

function startStatsTimer(statsRef: StatsRef): ReturnType<typeof setInterval> {
  return setInterval(() => {
    const s = statsRef.current;
    useSession.getState().patchStreaming({
      packets: s.packets,
      samples: s.samples,
      drops: s.drops,
      lastSeq: s.lastSeq,
      generation: s.generation,
      deviceReboots: s.deviceReboots,
    });
  }, 500);
}

// Level-based data-stall watchdog. onDeviceDisconnected only fires on an actual
// link drop; a firmware hang with the link still up delivers no packets while
// the OS reports connected, stranding the session forever. Every
// WATCHDOG_INTERVAL_MS we check whether the packet counter advanced; after
// enough frozen ticks we force the link down so the existing reconnect path
// (onDeviceDisconnected → reconnectLoop) takes over. Paused while a reconnect
// is already in flight, and re-baselined after one so a fresh link isn't judged
// stalled before its first packet. Cleared on stop and on a fatal failSession
// (we must NOT reconnect after storage-full).
function startWatchdog(): ReturnType<typeof setInterval> {
  let wd = freshWatchdogState();
  return setInterval(() => {
    if (!active || active.userStopped) return;
    const manager = getBleManager();
    if (!manager) return; // stub / Expo Go — no native link to cancel
    const tick = stallTick(wd, active.statsRef.current.packets, active.reconnecting);
    wd = tick.state;
    if (!tick.forceReconnect) return;
    const deviceId = active.deviceId;
    if (__DEV__) console.warn('[stream] data stall — forcing reconnect');
    // cancelDeviceConnection emits a disconnect the registerDisconnectWatch
    // listener is already subscribed to, which drives reconnectLoop.
    manager.cancelDeviceConnection(deviceId).catch(() => undefined);
  }, WATCHDOG_INTERVAL_MS);
}

export async function startSession(
  deviceId: string,
  serial?: string | null,
): Promise<{ sessionId: string }> {
  if (active) return { sessionId: active.sessionId };

  // Pre-flight: refuse to start a night the phone can't hold. An 8-h recording
  // is written to EEG.BIN incrementally; if storage fills mid-night the native
  // write fails and capture halts (surfaced via StorageWriteError, but only
  // after data is already lost). Checking BEFORE the BLE connect fails fast with
  // a clear, blocking message and without even touching the radio. A flaky
  // disk-space read yields ok=true (never block a legit recording) — the live
  // StorageWriteError path stays the backstop.
  const disk = checkDiskSpace();
  if (!disk.ok) {
    throw new InsufficientStorageError(disk.freeBytes, disk.requiredBytes);
  }

  const sessionId = generateSessionId();
  const startedAtMs = Date.now();
  // Time-bounded so a device that's off fails fast instead of hanging forever.
  const device = await bleClient.connect(deviceId, { timeoutMs: CONNECT_TIMEOUT_MS });

  // Pre-flight: refuse to record on an UNCONFIGURED board. variant_known === 0
  // means the firmware didn't recognize this board's MAC and is running YELLOW
  // fallback defaults (CH1/0xFC) — the channel/BIAS may be wrong, so the night
  // can come back fully railed (a real 4-h night was lost exactly this way and
  // looked valid because nothing surfaced it). Block BEFORE any data is written.
  // variantKnown === null (older v1 firmware) is "unknown but don't block" —
  // back-compat: those units predate the byte and recorded fine for months.
  if (device.scale.variantKnown === 0) {
    await device.disconnect().catch(() => undefined);
    throw new UnconfiguredDeviceError();
  }

  const statsRef: StatsRef = { current: freshStats() };
  const cb = makeCallbacks(statsRef);
  // Drive the 30-min chunked upload (Feature 2). Set BEFORE startStream so the
  // first rolled segment has a session context to enqueue against. No-op unless
  // chunked upload is enabled.
  startChunkDriver({ sessionId, startedAtMs, serial: serial ?? null });
  const handle = await device.startStream(sessionId, cb);

  // Durable recovery hooks (best-effort; recording proceeds regardless): a
  // self-describing meta.json in the session dir + an active-recording marker
  // so an iOS state-restoration relaunch knows what to resume.
  const meta: RecordingMeta = { sessionId, startedAtMs, deviceId, serial: serial ?? null };
  writeSessionMeta(meta);
  void setActiveRecording(meta);

  useSession.getState().setStreaming({
    sessionId,
    startedAtMs,
    packets: 0,
    samples: 0,
    drops: 0,
    lastSeq: null,
    generation: 0,
    connection: 'connected',
    error: null,
  });

  const statsTimer = startStatsTimer(statsRef);
  const watchdogTimer = startWatchdog();

  // Keep the process alive overnight (screen off / backgrounded).
  const fgStarted = startForegroundService({ startMs: startedAtMs });
  // Overnight insurance: ask the OS to exempt us from Doze (no-op on iOS, when
  // already exempt, or on older native builds). User-initiated start only — not
  // the background restore path, where launching the system dialog would fail.
  ensureBatteryOptimizationExemption();

  active = {
    sessionId,
    startedAtMs,
    deviceId,
    meta,
    handle,
    device,
    statsTimer,
    watchdogTimer,
    cb,
    statsRef,
    disconnectSub: null,
    lostTimer: null,
    abandonTimer: null,
    batteryUnsub: null,
    userStopped: false,
    reconnecting: false,
    terminalReason: null,
  };

  registerDisconnectWatch();

  // Auto-end on a dead battery (Feature 3). The battery level (0x2A19) flows to
  // the store from a BLE callback even backgrounded, so this stays live with the
  // screen off. Check the current value, then on every change.
  const checkBattery = (level: number | null): void => {
    if (active && !active.userStopped && batteryShouldStop(level)) void endSessionAuto('battery');
  };
  active.batteryUnsub = useSession.subscribe((s) => checkBattery(s.deviceBattery));
  checkBattery(useSession.getState().deviceBattery);

  // If the Android keep-alive service didn't actually start, the recording can
  // die the moment the screen locks. Surface it instead of failing silently.
  if (!fgStarted) {
    useSession.getState().patchStreaming({
      error: 'Couldn’t start background recording — keep the screen on and the app open.',
    });
  }

  return { sessionId };
}

/**
 * Resume an interrupted recording after iOS state restoration cold-starts the
 * app in the background. Appends onto the SAME session dir (AppendingFile seeks
 * to EOF), so the night continues into one file. Best-effort and defensive —
 * any failure leaves the partial file on disk for launch-time recovery instead.
 */
export async function resumeSessionAfterRestore(meta: RecordingMeta): Promise<void> {
  if (active) return; // already recording — nothing to restore
  const { sessionId, deviceId, startedAtMs } = meta;
  if (!deviceId) return;
  // Claim the session before the (untimed, possibly slow) connect so a
  // concurrent recoverAll excludes this dir even if the re-link outlasts the
  // recovery grace window — otherwise it could upload+delete it mid-resume.
  restoringSessionId = sessionId;
  try {
    // Restored peripheral connects fast (already linked at the OS level). No
    // timeout — this runs backgrounded where the pending connect is desirable.
    const device = await bleClient.connect(deviceId);
    const statsRef: StatsRef = { current: freshStats() };
    const cb = makeCallbacks(statsRef);
    // Resume chunked upload for the restored session (segments roll into the same
    // segments/eeg dir, continuing past existing indices). No-op when disabled.
    startChunkDriver({ sessionId, startedAtMs, serial: meta.serial ?? null });
    const handle = await device.startStream(sessionId, cb);
    if (active) {
      await stopChunkDriver();
      await handle.stop().catch(() => undefined);
      await device.disconnect().catch(() => undefined);
      return;
    }
    useSession.getState().setStreaming({
      sessionId,
      startedAtMs,
      packets: 0,
      samples: 0,
      drops: 0,
      lastSeq: null,
      generation: 0,
      connection: 'connected',
      error: null,
    });
    const statsTimer = startStatsTimer(statsRef);
    const watchdogTimer = startWatchdog();
    startForegroundService({ startMs: startedAtMs });
    active = {
      sessionId,
      startedAtMs,
      deviceId,
      meta,
      handle,
      device,
      statsTimer,
      watchdogTimer,
      cb,
      statsRef,
      disconnectSub: null,
      lostTimer: null,
      abandonTimer: null,
      batteryUnsub: null,
      userStopped: false,
      reconnecting: false,
      terminalReason: null,
    };
    registerDisconnectWatch();
    if (__DEV__) console.log('[stream] resumed session after iOS restore', sessionId);
  } catch (e) {
    if (__DEV__) console.warn('[stream] resume after restore failed', e);
  } finally {
    // Resume settled (took over as `active`, aborted, or failed) — drop the
    // claim. If it succeeded, activeOrRestoringSessionId now reports the live id.
    restoringSessionId = null;
  }
}

function registerDisconnectWatch(): void {
  if (!active) return;
  const manager = getBleManager();
  if (!manager) return; // stub / Expo Go — no native disconnect events
  const session = active;
  session.disconnectSub?.remove();
  session.disconnectSub = manager.onDeviceDisconnected(session.deviceId, () => {
    if (!active || active.sessionId !== session.sessionId) return;
    if (active.userStopped || active.reconnecting) return;
    // Tell the user the headband dropped, the moment it happens — before the
    // reconnect grace window. The `reconnecting` guard above means this fires
    // once per disconnect, not on every retry tick.
    notifyDeviceDisconnected();
    reconnectLoop().catch((e) => {
      if (__DEV__) console.warn('[stream] reconnect loop crashed', e);
    });
  });
}

async function reconnectLoop(): Promise<void> {
  if (!active || active.reconnecting || active.userStopped) return;
  active.reconnecting = true;
  useSession.getState().patchStreaming({ connection: 'reconnecting' });

  // Escalate to 'lost' if we can't get back within LOST_AFTER_MS — while STILL
  // retrying below. Cleared on a successful reconnect or on stop.
  if (active.lostTimer) clearTimeout(active.lostTimer);
  active.lostTimer = setTimeout(() => {
    if (active && active.reconnecting && !active.userStopped) {
      useSession.getState().patchStreaming({ connection: 'lost' });
    }
  }, LOST_AFTER_MS);

  // Device powered off / dead: if we still can't reconnect after this window,
  // auto-finalize the night instead of retrying forever (Feature 3).
  if (active.abandonTimer) clearTimeout(active.abandonTimer);
  active.abandonTimer = setTimeout(() => {
    if (active && active.reconnecting && !active.userStopped) {
      void endSessionAuto('device-lost');
    }
  }, DEVICE_ABANDONED_MS);

  let attempt = 0;
  while (active && !active.userStopped) {
    attempt++;
    // Snapshot session identity BEFORE any await — stopSession() can null
    // `active` while we're parked on connect()/startStream().
    const sessionId = active.sessionId;
    const deviceId = active.deviceId;
    const cb = active.cb;
    const resumeFromBaseMs = active.statsRef.current.lastBaseMs ?? null;
    const oldDevice = active.device;
    try {
      // Tear down the dead stream handle before re-subscribing so we don't
      // leak the old characteristic monitor / ACK timer.
      await active.handle.stop().catch(() => undefined);
      // Disconnect the OLD device too — this removes its battery monitor.
      // Without it, every reconnect leaks a battery-characteristic
      // subscription (a flaky night stacks up dozens).
      await oldDevice.disconnect().catch(() => undefined);

      // No timeout: keep the autoConnect pending connect so iOS/Android can
      // complete the link whenever the device returns, even while backgrounded.
      const device = await bleClient.connect(deviceId);
      // The user may have stopped (or a newer session started) while connect
      // was in flight — if so, tear down this fresh connection and bail so we
      // don't orphan a BLE link + battery monitor past stopSession().
      if (!active || active.userStopped || active.sessionId !== sessionId) {
        await device.disconnect().catch(() => undefined);
        return;
      }

      const handle = await device.startStream(sessionId, cb, { resumeFromBaseMs });
      if (!active || active.userStopped || active.sessionId !== sessionId) {
        await handle.stop().catch(() => undefined);
        await device.disconnect().catch(() => undefined);
        return;
      }

      active.device = device;
      active.handle = handle;
      active.reconnecting = false;
      if (active.lostTimer) {
        clearTimeout(active.lostTimer);
        active.lostTimer = null;
      }
      if (active.abandonTimer) {
        clearTimeout(active.abandonTimer);
        active.abandonTimer = null;
      }
      useSession.getState().patchStreaming({ connection: 'connected' });
      registerDisconnectWatch(); // re-arm for the new connection
      // Link is back — flush any chunks queued during the outage (Feature 2).
      void drainChunks();
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
  if (active?.lostTimer) {
    clearTimeout(active.lostTimer);
    active.lostTimer = null;
  }
}

// Fatal, non-recoverable stream error (storage full). Stop writing + free the
// keep-alive, but KEEP `active` so the user's "Stop recording" still finalizes
// the partial recording into the saved/upload flow. Whatever was flushed is
// safe on disk; the surfaced error explains why it stopped.
async function failSession(message: string): Promise<void> {
  if (!active) return;
  active.terminalReason = 'storage-error';
  active.reconnecting = false;
  if (active.lostTimer) {
    clearTimeout(active.lostTimer);
    active.lostTimer = null;
  }
  if (active.abandonTimer) {
    clearTimeout(active.abandonTimer);
    active.abandonTimer = null;
  }
  active.batteryUnsub?.();
  active.batteryUnsub = null;
  // Stop the watchdog — a fatal storage error must NOT trigger a reconnect (the
  // disk is full; reconnecting would just restart streaming into a full disk).
  if (active.watchdogTimer) {
    clearInterval(active.watchdogTimer);
    active.watchdogTimer = null;
  }
  active.disconnectSub?.remove();
  active.disconnectSub = null;
  const stats = await active.handle.stop().catch(() => active?.statsRef.current ?? freshStats());
  const endMs = endMsFromSamples(active.startedAtMs, stats);
  writeSessionMeta({ ...active.meta, endMs });
  await writeStreamStatsSidecar({
    sessionId: active.sessionId,
    startedAtMs: active.startedAtMs,
    endMs,
    stopReason: 'storage-error',
    stats,
  }).catch(() => undefined);
  // Best-effort: ship whatever segments are already queued (uploading frees the
  // disk that just filled), then stop the driver. No-op when disabled.
  void stopChunkDriver();
  stopForegroundService();
  useSession.getState().patchStreaming({ connection: 'lost', error: message });
}

export type StopResult = {
  sessionId: string;
  sessionDir: string;
  eegUri: string;
  stats: StreamStats;
};

// Auto-finalize an overnight recording when the headband is gone (battery dead or
// powered off) — instead of reconnecting forever. Tears the session down like
// stopSession, then sends the same cloud finalize path used by manual sync so a
// partial night still produces a database row + backend report.
async function endSessionAuto(reason: 'battery' | 'device-lost'): Promise<void> {
  if (!active) return;
  const session = active;
  active.userStopped = true; // stops the reconnect loop
  active = null;

  session.disconnectSub?.remove();
  if (session.lostTimer) clearTimeout(session.lostTimer);
  if (session.abandonTimer) clearTimeout(session.abandonTimer);
  session.batteryUnsub?.();
  clearInterval(session.statsTimer);
  if (session.watchdogTimer) clearInterval(session.watchdogTimer);
  const stats = await session.handle.stop().catch(() => session.statsRef.current);
  const endMs = endMsFromSamples(session.startedAtMs, stats);
  writeSessionMeta({ ...session.meta, endMs });
  // Drain the final + any queued segments before teardown (Feature 2). No-op when
  // disabled; anything still unconfirmed stays queued for launch-time recovery.
  await stopChunkDriver();
  await writeStreamStatsSidecar({
    sessionId: session.sessionId,
    startedAtMs: session.startedAtMs,
    endMs,
    stopReason: reason,
    stats,
  }).catch(() => undefined);
  await session.device.disconnect().catch(() => undefined);
  stopForegroundService();
  // No longer the active session to resume. If cloud handoff below fails, launch-
  // time recovery still sees meta.endMs and finalizes with the real data length.
  await clearActiveRecording();
  useSession.getState().setStreaming(null);
  try {
    await transmitSession({ sessionId: session.sessionId, startMs: session.startedAtMs, endMs });
  } catch (e) {
    if (__DEV__) console.warn('[stream] auto-finalize failed; recovery will retry', e);
  }
  // Tell the user it stopped (and why) — they may have walked away assuming it
  // was still recording.
  notifyRecordingStopped(reason);
  if (__DEV__) console.log(`[stream] auto-ended recording (${reason})`);
}

export async function stopSession(): Promise<StopResult | null> {
  if (!active) return null;
  const session = active;
  active.userStopped = true;
  active = null;

  session.disconnectSub?.remove();
  if (session.lostTimer) clearTimeout(session.lostTimer);
  if (session.abandonTimer) clearTimeout(session.abandonTimer);
  session.batteryUnsub?.();
  clearInterval(session.statsTimer);
  if (session.watchdogTimer) clearInterval(session.watchdogTimer);
  const stats = await session.handle.stop().catch(() => session.statsRef.current);
  const endMs = endMsFromSamples(session.startedAtMs, stats);
  writeSessionMeta({ ...session.meta, endMs });
  // handle.stop() flushed + emitted the final segment; drain it (and anything
  // queued) before we tear down, then stop the driver. No-op when disabled.
  await stopChunkDriver();
  await writeStreamStatsSidecar({
    sessionId: session.sessionId,
    startedAtMs: session.startedAtMs,
    endMs,
    stopReason: session.terminalReason ?? 'manual',
    stats,
  }).catch(() => undefined);
  await session.device.disconnect().catch(() => undefined);

  stopForegroundService();
  // The night is finalized and about to be uploaded — it's no longer the
  // "active" session to resume. (Launch-time recovery still finds the on-disk
  // file independently if the upload never happens.)
  void clearActiveRecording();
  useSession.getState().setStreaming(null);

  return {
    sessionId: session.sessionId,
    sessionDir: session.handle.sessionDir,
    eegUri: session.handle.eegUri,
    stats,
  };
}

function generateSessionId(): string {
  // expo-crypto's randomUUID is RFC4122 v4 in SDK 54. We avoid the bare
  // crypto import in module top level so test/web environments don't crash.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Crypto = require('expo-crypto') as { randomUUID?: () => string };
  if (typeof Crypto.randomUUID === 'function') return Crypto.randomUUID();
  // Fallback: timestamp + random — collision risk negligible at 1 session/day.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
