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
import type { ConnectedDevice, StreamHandle, StreamStats } from './types';
import { useSession } from '../../state/session';

type ActiveSession = {
  sessionId: string;
  handle: StreamHandle;
  device: ConnectedDevice;
  statsTimer: ReturnType<typeof setInterval>;
};

let active: ActiveSession | null = null;

export function isSessionActive(): boolean {
  return active !== null;
}

export async function startSession(deviceId: string): Promise<{ sessionId: string }> {
  if (active) return { sessionId: active.sessionId };

  const sessionId = generateSessionId();
  const device = await bleClient.connect(deviceId);

  // Snapshot of the most recent stats. We can't push every packet (~62 Hz)
  // through Zustand without re-rendering the whole tree every 16 ms; instead
  // we hold the latest stats in a ref and flush them every 500 ms.
  let latest: StreamStats = {
    packets: 0,
    samples: 0,
    drops: 0,
    lastSeq: null,
    generation: 0,
  };

  const handle = await device.startStream(sessionId, {
    onPacket: (_pkt, stats) => {
      latest = stats;
    },
    onDrop: (_reason, stats) => {
      latest = stats;
    },
    onError: (err) => {
      if (__DEV__) console.warn('[stream] error:', err.message);
      useSession.getState().patchStreaming({ connection: 'lost' });
    },
  });

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
    useSession.getState().patchStreaming({
      packets: latest.packets,
      samples: latest.samples,
      drops: latest.drops,
      lastSeq: latest.lastSeq,
      generation: latest.generation,
    });
  }, 500);

  active = { sessionId, handle, device, statsTimer };
  return { sessionId };
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
  active = null;

  clearInterval(session.statsTimer);
  const stats = await session.handle.stop();
  await session.device.disconnect().catch(() => undefined);

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
