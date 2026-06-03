// Multi-device recording controller — TEMPORARY two-person overnight feature.
//
// 2026-06-01: lets two headbands record to one phone at once (e.g. Aleksas +
// Goda), each to its OWN EEG.BIN/EOG.BIN. Deliberately SELF-CONTAINED and
// separate from streamController.ts so it cannot disturb the proven
// single-device path. Reuses the per-device bleClient.connect()/startStream()
// primitives, which already produce independent sessions + files.
//
// Scope note: a phone's BLE radio holds several simultaneous connections fine;
// each Cerelog has a distinct MAC + name, so connecting to two is supported.
// This is a stopgap until the iOS app — keep it simple, no shared state.

import { bleClient } from './index';
import { getBleManager } from './manager';
import type { ConnectedDevice, StreamHandle, StreamStats } from './types';

export type MultiSlot = {
  deviceId: string;
  serial: string;            // advertised name, e.g. Neurex-EEG-4CE2
  sessionId: string;
  device: ConnectedDevice;
  handle: StreamHandle;
  startedAtMs: number;
  latest: StreamStats;
  statsTimer: ReturnType<typeof setInterval>;
};

export type MultiStopResult = {
  serial: string;
  sessionId: string;
  eegUri: string;
  eogUri: string;
  samples: number;
  startedAtMs: number;
};

// Keyed by deviceId — each device is fully independent (own files, own ACK
// loop inside its StreamHandle). No cross-device shared state.
const slots = new Map<string, MultiSlot>();

export function multiActiveCount(): number {
  return slots.size;
}

export function multiIsActive(deviceId: string): boolean {
  return slots.has(deviceId);
}

export function multiSnapshot(): {
  deviceId: string;
  serial: string;
  samples: number;
  startedAtMs: number;
}[] {
  return Array.from(slots.values()).map((s) => ({
    deviceId: s.deviceId,
    serial: s.serial,
    samples: s.latest.samples,
    startedAtMs: s.startedAtMs,
  }));
}

function genSessionId(serial: string): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Crypto = require('expo-crypto') as { randomUUID?: () => string };
  const base =
    typeof Crypto.randomUUID === 'function'
      ? Crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  // Prefix with the serial so the two folders are human-distinguishable.
  return `${serial}_${base}`;
}

export async function multiStart(deviceId: string, serial: string): Promise<void> {
  if (slots.has(deviceId)) return;
  const sessionId = genSessionId(serial);
  const device = await bleClient.connect(deviceId);

  // DUAL-RECORD FIX (2026-06-03): each headband's firmware pins a 7.5 ms
  // connection interval, and one phone radio can't serve two of them at once —
  // the 2nd link gets starved and receives zero notifications. Ask the central
  // for BALANCED priority (~30 ms) so the controller can interleave both links.
  // The firmware requests its interval once (no re-assert), so this central
  // relaxation sticks. Single-device recording (streamController) never calls
  // this, so its full-rate 7.5 ms path is unaffected.
  try {
    await getBleManager()?.requestConnectionPriorityForDevice(deviceId, 0 /* Balanced */);
  } catch (e) {
    if (__DEV__) console.warn('[multi] requestConnectionPriority failed:', deviceId, e);
  }

  let latest: StreamStats = {
    packets: 0,
    samples: 0,
    drops: 0,
    dupSkips: 0,
    lastSeq: null,
    generation: 0,
    lastBaseMs: null,
  };

  const handle = await device.startStream(sessionId, {
    onPacket: (_pkt, stats) => {
      latest = stats;
    },
    onDrop: (_reason, stats) => {
      latest = stats;
    },
    onError: (err) => {
      // Surface it (was silently swallowed). The file already on disk is
      // preserved; this just makes a failing 2nd link visible in the logs.
      if (__DEV__) console.warn('[multi] stream error:', deviceId, err.message);
    },
  });

  // Lightweight stats poll so the UI can show per-device sample counts.
  const statsTimer = setInterval(() => {
    const slot = slots.get(deviceId);
    if (slot) slot.latest = latest;
  }, 1000);

  slots.set(deviceId, {
    deviceId,
    serial,
    sessionId,
    device,
    handle,
    startedAtMs: Date.now(),
    latest,
    statsTimer,
  });
}

export async function multiStop(deviceId: string): Promise<MultiStopResult | null> {
  const slot = slots.get(deviceId);
  if (!slot) return null;
  slots.delete(deviceId);

  clearInterval(slot.statsTimer);
  const stats = await slot.handle.stop();
  await slot.device.disconnect().catch(() => undefined);

  return {
    serial: slot.serial,
    sessionId: slot.sessionId,
    eegUri: slot.handle.eegUri,
    eogUri: slot.handle.eogUri,
    samples: stats.samples,
    startedAtMs: slot.startedAtMs,
  };
}

export async function multiStopAll(): Promise<MultiStopResult[]> {
  const ids = Array.from(slots.keys());
  const out: MultiStopResult[] = [];
  for (const id of ids) {
    const r = await multiStop(id);
    if (r) out.push(r);
  }
  return out;
}
