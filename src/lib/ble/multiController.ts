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
import { startForegroundService, stopForegroundService } from './foregroundService';
import type { ConnectedDevice, StreamCallbacks, StreamHandle, StreamStats } from './types';

// Per-device stall watchdog. Under two simultaneous high-rate connections,
// ble-plx can silently stop delivering one device's notifications (the native
// link stays up, no error/disconnect — the firmware's controller TX queue just
// fills and it can't push). We detect "samples stopped changing" and recover by
// disconnecting + reconnecting that one device, resuming to the SAME files (the
// real.ts dedup guard keeps the resumed stream from writing dups).
const STALL_MS = 8000;
const WATCHDOG_TICK_MS = 2000;

export type MultiSlot = {
  deviceId: string;
  serial: string;            // advertised name, e.g. Neurex-EEG-4CE2
  sessionId: string;
  device: ConnectedDevice;
  handle: StreamHandle;
  cb: StreamCallbacks;       // reused verbatim when recovering the stream
  startedAtMs: number;
  latest: StreamStats;
  statsTimer: ReturnType<typeof setInterval>;
  recovering: boolean;
  lastSamples: number;       // last sample count the watchdog saw
  lastProgressMs: number;    // when the count last changed
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

let watchdogTimer: ReturnType<typeof setInterval> | null = null;

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

// Relax the connection priority so two links can be interleaved by the radio.
// Best-effort: iOS no-ops, and a failure isn't fatal.
async function relaxPriority(deviceId: string): Promise<void> {
  try {
    await getBleManager()?.requestConnectionPriorityForDevice(deviceId, 0 /* Balanced */);
  } catch (e) {
    if (__DEV__) console.warn('[multi] requestConnectionPriority failed:', deviceId, e);
  }
}

export async function multiStart(deviceId: string, serial: string): Promise<void> {
  if (slots.has(deviceId)) return;
  const sessionId = genSessionId(serial);
  const device = await bleClient.connect(deviceId);

  // DUAL-RECORD FIX (2026-06-03): each headband's firmware pins a 7.5 ms
  // connection interval, and one phone radio can't serve two of them at once —
  // the 2nd link gets starved. Ask the central for BALANCED priority (~30 ms)
  // so the controller can interleave both links. Single-device recording
  // (streamController) never calls this, so its full-rate path is unaffected.
  await relaxPriority(deviceId);

  let latest: StreamStats = {
    packets: 0,
    samples: 0,
    drops: 0,
    dupSkips: 0,
    lastSeq: null,
    generation: 0,
    lastBaseMs: null,
  };

  const cb: StreamCallbacks = {
    onPacket: (_pkt, stats) => {
      latest = stats;
    },
    onDrop: (_reason, stats) => {
      latest = stats;
    },
    onError: (err) => {
      // Surface it (was silently swallowed). The file already on disk is
      // preserved; the watchdog handles a genuinely dead stream.
      if (__DEV__) console.warn('[multi] stream error:', deviceId, err.message);
    },
  };

  const handle = await device.startStream(sessionId, cb);

  // Lightweight stats poll so the UI can show per-device sample counts.
  const statsTimer = setInterval(() => {
    const slot = slots.get(deviceId);
    if (slot) slot.latest = latest;
  }, 1000);

  const now = Date.now();
  slots.set(deviceId, {
    deviceId,
    serial,
    sessionId,
    device,
    handle,
    cb,
    startedAtMs: now,
    latest,
    statsTimer,
    recovering: false,
    lastSamples: 0,
    lastProgressMs: now,
  });

  // First headband recording → keep the process alive overnight (screen off /
  // backgrounded), mirroring the single-device path, and arm the stall watchdog.
  if (slots.size === 1) {
    startForegroundService();
    ensureWatchdog();
  }
}

// Detect a stream whose sample count has frozen (ble-plx dropped its
// notifications) and recover just that device. A count that CHANGES at all —
// including the reset-to-0 a recovery produces — counts as progress, so only a
// truly frozen stream triggers (and it retries every ~STALL_MS if recovery
// doesn't take).
function ensureWatchdog(): void {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(() => {
    const now = Date.now();
    for (const slot of slots.values()) {
      if (slot.recovering) continue;
      const samples = slot.latest.samples;
      if (samples !== slot.lastSamples) {
        slot.lastSamples = samples;
        slot.lastProgressMs = now;
      } else if (now - slot.lastProgressMs > STALL_MS) {
        void recoverSlot(slot.deviceId);
      }
    }
  }, WATCHDOG_TICK_MS);
}

function stopWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}

async function recoverSlot(deviceId: string): Promise<void> {
  const slot = slots.get(deviceId);
  if (!slot || slot.recovering) return;
  slot.recovering = true;
  slot.lastProgressMs = Date.now(); // grace window so we don't re-trigger mid-recover
  if (__DEV__) console.warn('[multi] stall detected — recovering', deviceId);

  // Snapshot identity BEFORE any await — multiStop can delete the slot meanwhile.
  const sessionId = slot.sessionId;
  const cb = slot.cb;
  const resumeFromBaseMs = slot.latest.lastBaseMs ?? null;
  try {
    await slot.handle.stop().catch(() => undefined);
    await slot.device.disconnect().catch(() => undefined); // force a clean reconnect
    const device = await bleClient.connect(deviceId);
    if (!slots.has(deviceId)) {
      await device.disconnect().catch(() => undefined);
      return;
    }
    await relaxPriority(deviceId);
    const handle = await device.startStream(sessionId, cb, { resumeFromBaseMs });
    const s = slots.get(deviceId);
    if (!s) {
      await handle.stop().catch(() => undefined);
      await device.disconnect().catch(() => undefined);
      return;
    }
    s.device = device;
    s.handle = handle;
    if (__DEV__) console.log('[multi] recovered', deviceId);
  } catch (e) {
    if (__DEV__) console.warn('[multi] recover failed', deviceId, e);
  } finally {
    const s = slots.get(deviceId);
    if (s) {
      s.recovering = false;
      // Re-baseline so the next tick measures progress against the (possibly
      // reset) new stream rather than the pre-stall high-water count.
      s.lastSamples = s.latest.samples;
      s.lastProgressMs = Date.now();
    }
  }
}

export async function multiStop(deviceId: string): Promise<MultiStopResult | null> {
  const slot = slots.get(deviceId);
  if (!slot) return null;
  slots.delete(deviceId);

  clearInterval(slot.statsTimer);
  const stats = await slot.handle.stop();
  await slot.device.disconnect().catch(() => undefined);

  // Last headband stopped → release the foreground service + watchdog (after
  // this device's files are flushed/closed above).
  if (slots.size === 0) {
    stopForegroundService();
    stopWatchdog();
  }

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
