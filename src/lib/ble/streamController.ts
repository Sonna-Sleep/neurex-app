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
import type { ConnectedDevice, StreamHandle, StreamStats, StreamCallbacks } from './types';
import { useSession } from '../../state/session';
import { getBleManager } from './manager';
import { startForegroundService, stopForegroundService } from './foregroundService';
import { nextBackoffMs } from './backoff';
import {
  setActiveRecording,
  clearActiveRecording,
  writeSessionMeta,
  type RecordingMeta,
} from '../cloud/recovery';
import type { Subscription } from 'react-native-ble-plx';

// User-initiated session start: time-bounded so a mask that's off or out of
// range fails fast with an error instead of an infinite spinner. The background
// reconnect loop deliberately omits this.
const CONNECT_TIMEOUT_MS = 20_000;
// How long a reconnect may drag on before the UI escalates to "connection
// lost". Retries continue indefinitely (correct for an overnight run — the
// device may return); this just stops pretending a long outage is a brief blip.
const LOST_AFTER_MS = 90_000;

type StatsRef = { current: StreamStats };

type ActiveSession = {
  sessionId: string;
  startedAtMs: number;
  deviceId: string;
  handle: StreamHandle;
  device: ConnectedDevice;
  statsTimer: ReturnType<typeof setInterval>;
  cb: StreamCallbacks;
  // Holder, not a snapshot: real.ts allocates a fresh StreamStats object on
  // each (re)startStream, so we track the current one by reference here. The
  // stats timer and the reconnect loop both read statsRef.current.
  statsRef: StatsRef;
  disconnectSub: Subscription | null;
  // Escalates the UI to 'lost' if a reconnect drags past LOST_AFTER_MS.
  lostTimer: ReturnType<typeof setTimeout> | null;
  userStopped: boolean;
  reconnecting: boolean;
};

let active: ActiveSession | null = null;

export function isSessionActive(): boolean {
  return active !== null;
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
  };
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
    });
  }, 500);
}

export async function startSession(
  deviceId: string,
  serial?: string | null,
): Promise<{ sessionId: string }> {
  if (active) return { sessionId: active.sessionId };

  const sessionId = generateSessionId();
  const startedAtMs = Date.now();
  // Time-bounded so a mask that's off fails fast instead of hanging forever.
  const device = await bleClient.connect(deviceId, { timeoutMs: CONNECT_TIMEOUT_MS });

  const statsRef: StatsRef = { current: freshStats() };
  const cb = makeCallbacks(statsRef);
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

  // Keep the process alive overnight (screen off / backgrounded).
  const fgStarted = startForegroundService();

  active = {
    sessionId,
    startedAtMs,
    deviceId,
    handle,
    device,
    statsTimer,
    cb,
    statsRef,
    disconnectSub: null,
    lostTimer: null,
    userStopped: false,
    reconnecting: false,
  };

  registerDisconnectWatch();

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
  try {
    // Restored peripheral connects fast (already linked at the OS level). No
    // timeout — this runs backgrounded where the pending connect is desirable.
    const device = await bleClient.connect(deviceId);
    const statsRef: StatsRef = { current: freshStats() };
    const cb = makeCallbacks(statsRef);
    const handle = await device.startStream(sessionId, cb);
    if (active) {
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
    startForegroundService();
    active = {
      sessionId,
      startedAtMs,
      deviceId,
      handle,
      device,
      statsTimer,
      cb,
      statsRef,
      disconnectSub: null,
      lostTimer: null,
      userStopped: false,
      reconnecting: false,
    };
    registerDisconnectWatch();
    if (__DEV__) console.log('[stream] resumed session after iOS restore', sessionId);
  } catch (e) {
    if (__DEV__) console.warn('[stream] resume after restore failed', e);
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
  if (active?.lostTimer) {
    clearTimeout(active.lostTimer);
    active.lostTimer = null;
  }
}

// Fatal, non-recoverable stream error (storage full). Stop writing + free the
// keep-alive, but KEEP `active` so the user's "Stop session" still finalizes
// the partial recording into the saved/upload flow. Whatever was flushed is
// safe on disk; the surfaced error explains why it stopped.
async function failSession(message: string): Promise<void> {
  if (!active) return;
  active.reconnecting = false;
  if (active.lostTimer) {
    clearTimeout(active.lostTimer);
    active.lostTimer = null;
  }
  active.disconnectSub?.remove();
  active.disconnectSub = null;
  await active.handle.stop().catch(() => undefined);
  stopForegroundService();
  useSession.getState().patchStreaming({ connection: 'lost', error: message });
}

export type StopResult = {
  sessionId: string;
  sessionDir: string;
  eegUri: string;
  stats: StreamStats;
};

export async function stopSession(): Promise<StopResult | null> {
  if (!active) return null;
  const session = active;
  active.userStopped = true;
  active = null;

  session.disconnectSub?.remove();
  if (session.lostTimer) clearTimeout(session.lostTimer);
  clearInterval(session.statsTimer);
  const stats = await session.handle.stop().catch(() => session.statsRef.current);
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
