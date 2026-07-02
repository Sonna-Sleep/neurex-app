// Pre-flight disk-space guard for overnight recordings.
//
// An 8-hour night writes EEG/EOG RAW.BIN under documentDirectory/sessions/<id>/.
// If storage fills mid-night, the native file write fails and capture halts —
// surfaced (never silent) via RawStorageWriteError, but only AFTER the user has
// already lost part of the night. This module moves that check to BEFORE the
// recording starts:
// estimate the bytes a full night needs, compare against free space, and refuse
// to start when there isn't enough headroom.
//
// The byte math is pure (no Expo/RN imports) so it's unit-testable in plain Node
// (scripts/smoke-disk-space.ts), exactly like recoveryMath.ts / connectTimeout.ts.
// The single FS read (Paths.availableDiskSpace) is isolated in checkDiskSpace().

import { Paths } from 'expo-file-system';

import { RAW_BYTES_PER_SAMPLE } from '../cloud/recoveryMath';
import { EEG_SAMPLE_RATE_HZ } from './constants';

// A typical unattended night. Used only to size the headroom estimate — the
// recording itself is uncapped; this is "plan for a full night, don't start one
// we obviously can't finish".
export const NIGHT_HOURS = 8;

// Require this much MORE than the raw night estimate. A 2× margin covers the
// scale.json/meta.json sidecars, filesystem overhead, and other apps nibbling
// free space while we record — without being so conservative it blocks a phone
// that genuinely has room.
export const SAFETY_FACTOR = 2;

// Never start a night with less than this free regardless of the computed
// estimate.
export const MIN_FREE_FLOOR_BYTES = 150 * 1024 * 1024; // 150 MB

const MB = 1024 * 1024;

/** Bytes one recorded hour of EEG/EOG RAW.BIN occupies on disk:
 * 250 Hz x 24 B/sample x 3600 s = 21,600,000 B/h. */
export function bytesPerHour(): number {
  return EEG_SAMPLE_RATE_HZ * RAW_BYTES_PER_SAMPLE * 3600;
}

/** Bytes a full `hours`-long night is expected to write. */
export function estimateNightBytes(hours: number = NIGHT_HOURS): number {
  return Math.round(bytesPerHour() * Math.max(0, hours));
}

/** Minimum free space we require before allowing a recording to start: the
 * larger of (estimate × safety factor) and the absolute floor. */
export function requiredFreeBytes(hours: number = NIGHT_HOURS): number {
  return Math.max(estimateNightBytes(hours) * SAFETY_FACTOR, MIN_FREE_FLOOR_BYTES);
}

export type DiskSpaceVerdict = {
  ok: boolean;
  freeBytes: number;
  requiredBytes: number;
};

/** Pure decision: is `freeBytes` enough to start an `hours`-long night? Separated
 * from the FS read so it's exhaustively unit-testable. A non-finite/negative
 * free reading (sensor unavailable) is treated as "ok" — we never want a flaky
 * disk-space API to BLOCK a legitimate recording; the live raw write error
 * path remains the backstop. */
export function evaluateDiskSpace(
  freeBytes: number,
  hours: number = NIGHT_HOURS,
): DiskSpaceVerdict {
  const requiredBytes = requiredFreeBytes(hours);
  const unreadable = !Number.isFinite(freeBytes) || freeBytes < 0;
  return {
    ok: unreadable ? true : freeBytes >= requiredBytes,
    freeBytes,
    requiredBytes,
  };
}

/** Thrown by startSession when there isn't enough free storage for a night. The
 * message is user-facing (surfaced on the recording card), so it's plain-spoken
 * and tells the user what to do. */
export class InsufficientStorageError extends Error {
  readonly freeBytes: number;
  readonly requiredBytes: number;
  constructor(freeBytes: number, requiredBytes: number) {
    const freeMb = Math.max(0, Math.floor(freeBytes / MB));
    const needMb = Math.ceil(requiredBytes / MB);
    super(
      `Not enough free storage to record overnight — about ${freeMb} MB free, ` +
        `but a full night needs ~${needMb} MB. Free up some space on your phone, then try again.`,
    );
    this.name = 'InsufficientStorageError';
    this.freeBytes = freeBytes;
    this.requiredBytes = requiredBytes;
  }
}

/**
 * Read the device's free internal storage and decide whether a night fits.
 * Uses `Paths.availableDiskSpace` — the synchronous free-bytes getter in the
 * SDK 54 file-system API (expo-file-system v19; the legacy
 * getFreeDiskStorageAsync() is deprecated and THROWS at runtime in this
 * version). Any failure reading the value yields an "ok" verdict so a flaky API
 * never blocks a recording (the in-stream raw write error stays the backstop).
 */
export function checkDiskSpace(hours: number = NIGHT_HOURS): DiskSpaceVerdict {
  let freeBytes: number;
  try {
    freeBytes = Paths.availableDiskSpace;
  } catch {
    // Reading failed — don't block; let the recording proceed and rely on the
    // live storage-full error path if the disk really is full.
    freeBytes = Number.POSITIVE_INFINITY;
  }
  return evaluateDiskSpace(freeBytes, hours);
}
