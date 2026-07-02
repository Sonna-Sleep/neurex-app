import { Directory, File, Paths } from 'expo-file-system';

import { EEG_SAMPLE_RATE_HZ } from './constants';
import { RAW_RECORD_BYTES } from './rawRecord';
import type { StreamStats } from './types';

export const RECORDING_MANIFEST_NAME = 'recording_manifest.json';
const SCHEMA_VER = 1;

export type RecordingManifest = {
  schemaVer: number;
  sessionId: string;
  startedAtMs: number;
  sampleRateHz: number;
  rawRecordBytes: number;
  samplesWritten: number;
  packetsWritten: number;
  drops: number;
  dupSkips: number;
  deviceReboots: number;
  timeGapCount: number;
  totalTimeGapMs: number;
  maxTimeGapMs: number;
  lastSeq: number | null;
  generation: number;
  lastBaseMs: number | null;
  updatedAtMs: number;
};

export type EnsureManifestInput = {
  sessionId: string;
  startedAtMs: number;
  sampleRateHz?: number;
  rawRecordBytes?: number;
};

function sessionsDir(): Directory {
  return new Directory(Paths.document, 'sessions');
}

export function sessionDir(sessionId: string): Directory {
  return new Directory(sessionsDir(), sessionId);
}

export function manifestFile(sessionId: string): File {
  return new File(sessionDir(sessionId), RECORDING_MANIFEST_NAME);
}

function now(): number {
  return Date.now();
}

function defaultManifest(input: EnsureManifestInput): RecordingManifest {
  return {
    schemaVer: SCHEMA_VER,
    sessionId: input.sessionId,
    startedAtMs: input.startedAtMs,
    sampleRateHz: input.sampleRateHz ?? EEG_SAMPLE_RATE_HZ,
    rawRecordBytes: input.rawRecordBytes ?? RAW_RECORD_BYTES,
    samplesWritten: 0,
    packetsWritten: 0,
    drops: 0,
    dupSkips: 0,
    deviceReboots: 0,
    timeGapCount: 0,
    totalTimeGapMs: 0,
    maxTimeGapMs: 0,
    lastSeq: null,
    generation: 0,
    lastBaseMs: null,
    updatedAtMs: now(),
  };
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function nullableNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function normalize(raw: unknown, fallback: EnsureManifestInput): RecordingManifest {
  const d = defaultManifest(fallback);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d;
  const o = raw as Record<string, unknown>;
  return {
    ...d,
    schemaVer: num(o.schemaVer, SCHEMA_VER),
    sessionId: typeof o.sessionId === 'string' ? o.sessionId : d.sessionId,
    startedAtMs: num(o.startedAtMs, d.startedAtMs),
    sampleRateHz: num(o.sampleRateHz, d.sampleRateHz),
    rawRecordBytes: num(o.rawRecordBytes, d.rawRecordBytes),
    samplesWritten: num(o.samplesWritten),
    packetsWritten: num(o.packetsWritten),
    drops: num(o.drops),
    dupSkips: num(o.dupSkips),
    deviceReboots: num(o.deviceReboots),
    timeGapCount: num(o.timeGapCount),
    totalTimeGapMs: num(o.totalTimeGapMs),
    maxTimeGapMs: num(o.maxTimeGapMs),
    lastSeq: nullableNum(o.lastSeq),
    generation: num(o.generation),
    lastBaseMs: nullableNum(o.lastBaseMs),
    updatedAtMs: num(o.updatedAtMs, d.updatedAtMs),
  };
}

export function readRecordingManifest(sessionId: string): RecordingManifest | null {
  try {
    const f = manifestFile(sessionId);
    if (!f.exists) return null;
    const raw = JSON.parse(f.textSync());
    return normalize(raw, { sessionId, startedAtMs: 0 });
  } catch {
    return null;
  }
}

export function writeRecordingManifest(manifest: RecordingManifest): void {
  const dir = sessionDir(manifest.sessionId);
  if (!dir.exists) dir.create({ intermediates: true });
  const f = manifestFile(manifest.sessionId);
  if (!f.exists) f.create();
  f.write(JSON.stringify({ ...manifest, updatedAtMs: now() }));
}

export function ensureRecordingManifest(input: EnsureManifestInput): RecordingManifest {
  const existing = readRecordingManifest(input.sessionId);
  const manifest = normalize(existing, input);
  if (!existing || manifest.startedAtMs <= 0) manifest.startedAtMs = input.startedAtMs;
  manifest.sampleRateHz = input.sampleRateHz ?? manifest.sampleRateHz;
  manifest.rawRecordBytes = input.rawRecordBytes ?? manifest.rawRecordBytes;
  writeRecordingManifest(manifest);
  return manifest;
}

export function statsFromManifest(manifest: RecordingManifest | null): StreamStats {
  return {
    packets: manifest?.packetsWritten ?? 0,
    samples: manifest?.samplesWritten ?? 0,
    drops: manifest?.drops ?? 0,
    dupSkips: manifest?.dupSkips ?? 0,
    lastSeq: manifest?.lastSeq ?? null,
    generation: manifest?.generation ?? 0,
    lastBaseMs: manifest?.lastBaseMs ?? null,
    timeGapCount: manifest?.timeGapCount ?? 0,
    totalTimeGapMs: manifest?.totalTimeGapMs ?? 0,
    maxTimeGapMs: manifest?.maxTimeGapMs ?? 0,
    deviceReboots: manifest?.deviceReboots ?? 0,
    rawRequired: false,
    rawOpened: false,
    rawBytesWritten: 0,
    rawClosed: false,
    rawUploaded: false,
    rawSha256: null,
    rawFailureReason: null,
    imuAvailable: false,
    imuOpened: false,
    imuNotifications: 0,
    imuBytesWritten: 0,
    imuClosed: false,
    imuUploaded: false,
    imuSha256: null,
    imuFailureReason: null,
  };
}

export function endMsFromManifest(manifest: RecordingManifest): number {
  const rate = manifest.sampleRateHz || EEG_SAMPLE_RATE_HZ;
  return manifest.startedAtMs + Math.round((manifest.samplesWritten / rate) * 1000);
}

export class RecordingManifestTracker {
  private manifest: RecordingManifest;
  private lastFlushAtMs = 0;

  constructor(input: EnsureManifestInput) {
    this.manifest = ensureRecordingManifest(input);
  }

  snapshot(): RecordingManifest {
    return this.manifest;
  }

  stats(): StreamStats {
    return statsFromManifest(this.manifest);
  }

  markDrop(count = 1): void {
    this.manifest.drops += count;
    this.flushThrottled();
  }

  markDuplicate(): void {
    this.manifest.dupSkips += 1;
    this.flushThrottled();
  }

  markReboot(): void {
    this.manifest.deviceReboots += 1;
    this.flush();
  }

  markTimeGap(gapMs: number): void {
    this.manifest.timeGapCount += 1;
    this.manifest.totalTimeGapMs += gapMs;
    this.manifest.maxTimeGapMs = Math.max(this.manifest.maxTimeGapMs, gapMs);
    this.flushThrottled();
  }

  markPacketWritten(input: {
    seq: number;
    generation: number;
    lastBaseMs: number;
    samples: number;
    bytesWritten: number;
  }): void {
    this.manifest.packetsWritten += 1;
    this.manifest.samplesWritten += input.samples;
    this.manifest.lastSeq = input.seq;
    this.manifest.generation = input.generation;
    this.manifest.lastBaseMs = input.lastBaseMs;
    this.flushThrottled();
  }

  flushThrottled(): void {
    const t = now();
    if (t - this.lastFlushAtMs < 3000) return;
    this.flush();
  }

  flush(): void {
    this.lastFlushAtMs = now();
    writeRecordingManifest(this.manifest);
  }
}
