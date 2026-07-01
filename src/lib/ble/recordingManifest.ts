import { Directory, File, Paths } from 'expo-file-system';

import { EEG_SAMPLE_RATE_HZ } from './constants';
import type { StreamStats } from './types';

export const RECORDING_MANIFEST_NAME = 'recording_manifest.json';
const SCHEMA_VER = 1;
const EEG_RECORD_BYTES = 8;

export type ManifestSegment = {
  index: number;
  bytes: number;
  closedAtMs: number;
  uploadedAtMs?: number;
};

export type RecordingManifest = {
  schemaVer: number;
  sessionId: string;
  startedAtMs: number;
  sampleRateHz: number;
  eegRecordBytes: number;
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
  nextSegmentIndex: number;
  currentSegmentIndex: number | null;
  currentSegmentBytes: number;
  closedSegments: ManifestSegment[];
  uploadedSegments: ManifestSegment[];
  updatedAtMs: number;
};

export type EnsureManifestInput = {
  sessionId: string;
  startedAtMs: number;
  sampleRateHz?: number;
  eegRecordBytes?: number;
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
    eegRecordBytes: input.eegRecordBytes ?? EEG_RECORD_BYTES,
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
    nextSegmentIndex: 0,
    currentSegmentIndex: null,
    currentSegmentBytes: 0,
    closedSegments: [],
    uploadedSegments: [],
    updatedAtMs: now(),
  };
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function nullableNum(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function segments(v: unknown): ManifestSegment[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s) => s && typeof s === 'object')
    .map((s) => {
      const o = s as Record<string, unknown>;
      return {
        index: num(o.index, -1),
        bytes: num(o.bytes),
        closedAtMs: num(o.closedAtMs),
        uploadedAtMs: nullableNum(o.uploadedAtMs) ?? undefined,
      };
    })
    .filter((s) => s.index >= 0);
}

function normalize(raw: unknown, fallback: EnsureManifestInput): RecordingManifest {
  const d = defaultManifest(fallback);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d;
  const o = raw as Record<string, unknown>;
  const closed = segments(o.closedSegments);
  const uploaded = segments(o.uploadedSegments);
  const maxKnown = Math.max(
    -1,
    ...closed.map((s) => s.index),
    ...uploaded.map((s) => s.index),
    num(o.currentSegmentIndex, -1),
    num(o.nextSegmentIndex, 0) - 1,
  );
  return {
    ...d,
    schemaVer: num(o.schemaVer, SCHEMA_VER),
    sessionId: typeof o.sessionId === 'string' ? o.sessionId : d.sessionId,
    startedAtMs: num(o.startedAtMs, d.startedAtMs),
    sampleRateHz: num(o.sampleRateHz, d.sampleRateHz),
    eegRecordBytes: num(o.eegRecordBytes, d.eegRecordBytes),
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
    nextSegmentIndex: Math.max(num(o.nextSegmentIndex), maxKnown + 1, 0),
    currentSegmentIndex: nullableNum(o.currentSegmentIndex),
    currentSegmentBytes: num(o.currentSegmentBytes),
    closedSegments: closed,
    uploadedSegments: uploaded,
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
  manifest.eegRecordBytes = input.eegRecordBytes ?? manifest.eegRecordBytes;
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

  nextSegmentIndex(): number {
    return Math.max(0, this.manifest.nextSegmentIndex);
  }

  markSegmentOpened(index: number): void {
    this.manifest.currentSegmentIndex = index;
    this.manifest.currentSegmentBytes = 0;
    this.manifest.nextSegmentIndex = Math.max(this.manifest.nextSegmentIndex, index + 1);
    this.flush();
  }

  markSegmentClosed(index: number, bytes: number): void {
    const rest = this.manifest.closedSegments.filter((s) => s.index !== index);
    this.manifest.closedSegments = [...rest, { index, bytes, closedAtMs: now() }].sort(
      (a, b) => a.index - b.index,
    );
    if (this.manifest.currentSegmentIndex === index) {
      this.manifest.currentSegmentIndex = null;
      this.manifest.currentSegmentBytes = 0;
    }
    this.flush();
  }

  addCurrentSegmentBytes(bytes: number): void {
    if (this.manifest.currentSegmentIndex === null) return;
    this.manifest.currentSegmentBytes += bytes;
  }

  markUploadedSegment(index: number, bytes: number): void {
    const rest = this.manifest.uploadedSegments.filter((s) => s.index !== index);
    this.manifest.uploadedSegments = [
      ...rest,
      { index, bytes, closedAtMs: now(), uploadedAtMs: now() },
    ].sort((a, b) => a.index - b.index);
    this.flush();
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
