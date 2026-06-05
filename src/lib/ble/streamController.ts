// Orchestrates a single live recording session:
//   start  → bleClient.connect → device.startStream(...)  + push live state to Zustand
//   stop   → handle.stop() → device.disconnect() → return file URIs for upload
//
// Module-level state (active session) is deliberate — the StreamHandle is a
// closure that must outlive the React component that started the stream
// (the user can navigate away from Home mid-session). Phase B replaces this
// with a foreground service + iOS state-restoration coordinator, but the
// shape stays the same.

import { bleClient } from './index';
import type { ConnectedDevice, StreamHandle, StreamStats, StreamCallbacks } from './types';
import { useSession } from '../../state/session';
import { getBleManager } from './manager';
import { startForegroundService, stopForegroundService } from './foregroundService';
import { nextBackoffMs } from './backoff';
import type { Subscription } from 'react-native-ble-plx';

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

let active: ActiveSession | null = null;

export function isSessionActive(): boolean {
  return active !== null;
}

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

  let attempt = 0;
  while (active && !active.userStopped) {
    attempt++;
    // Snapshot session identity BEFORE any await — stopSession() can null
    // `active` while we're parked on connect()/startStream().
    const sessionId = active.sessionId;
    const deviceId = active.deviceId;
    const cb = active.cb;
    const resumeFromBaseMs = active.statsRef.current.lastBaseMs ?? null;
    try {
      // Tear down the dead stream handle before re-subscribing so we don't
      // leak the old characteristic monitor / ACK timer.
      await active.handle.stop().catch(() => undefined);

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

export type StopResult = {
  sessionId: string;
  sessionDir: string;
  eegUri: string;
  eogUri: string;
  stats: StreamStats;
};

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

function generateSessionId(): string {
  // expo-crypto's randomUUID is RFC4122 v4 in SDK 54. We avoid the bare
  // crypto import in module top level so test/web environments don't crash.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Crypto = require('expo-crypto') as { randomUUID?: () => string };
  if (typeof Crypto.randomUUID === 'function') return Crypto.randomUUID();
  // Fallback: timestamp + random — collision risk negligible at 1 session/day.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
