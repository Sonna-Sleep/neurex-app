// Pure timing math for crash-recovery — NO Expo/RN imports, so it's
// unit-testable in plain Node (scripts/smoke-recovery.ts). recovery.ts wraps
// this with the filesystem scan.

export const RAW_HEADER_BYTES = 16;
export const RAW_BYTES_PER_SAMPLE = 40; // legacy 8-channel fallback record size

// Minimum recorded length worth uploading: short setup/debug captures are kept
// local instead of being sent to cloud analysis. Shared with the live
// RecordingCard sync gate so recovery and the in-app path apply the SAME floor.
export const MIN_STAGING_MIN = 10;
export const MIN_STAGING_SEC = MIN_STAGING_MIN * 60;

// On launch, if a recording was active when we were killed, an iOS state-
// restoration resume may be about to reclaim it (wakeHandler → resumeSession-
// AfterRestore). Wait this long before sweeping for orphans so we don't
// upload+delete the session dir out from under a resume in progress.
export const RECOVERY_RESTORE_GRACE_MS = 30_000;

/** True if a recording is long enough to be worth uploading/staging. */
export function isStageableDurationMs(durationMs: number): boolean {
  return durationMs >= MIN_STAGING_SEC * 1000;
}

/** Recorded duration (ms) implied by a RAW.BIN byte count. */
export function durationMsFromBytes(
  sizeBytes: number,
  sampleRateHz: number,
  rawBytesPerSample: number = RAW_BYTES_PER_SAMPLE,
): number {
  if (sizeBytes <= 0 || sampleRateHz <= 0 || rawBytesPerSample <= 0) return 0;
  const payloadBytes = Math.max(0, sizeBytes - RAW_HEADER_BYTES);
  return (payloadBytes / rawBytesPerSample / sampleRateHz) * 1000;
}

export type ReconstructInput = {
  sizeBytes: number;
  sampleRateHz: number;
  /** RAW.BIN record size from the manifest/header; defaults to legacy 8-channel. */
  rawBytesPerSample?: number | null;
  /** File modification time (ms epoch) — approximates when streaming stopped. */
  modificationTimeMs: number | null;
  /** Start time from meta.json when present (authoritative). */
  metaStartedAtMs?: number | null;
  /** Fallback "now" when the file has no modification time. */
  nowMs: number;
};

/**
 * Reconstruct {startedAtMs, endMs} for an orphaned recording. Prefers
 * meta.json's start time; otherwise back-calculates the start from the file's
 * modification time minus the duration implied by its byte count. endMs is
 * always start + recorded duration so the reported length matches the bytes on
 * disk (not wall-clock, which would overstate a night the device cut short).
 */
export function reconstructTiming(input: ReconstructInput): {
  startedAtMs: number;
  endMs: number;
} {
  const durationMs = durationMsFromBytes(
    input.sizeBytes,
    input.sampleRateHz,
    input.rawBytesPerSample ?? RAW_BYTES_PER_SAMPLE,
  );
  const endRef = input.modificationTimeMs ?? input.nowMs;
  const startedAtMs =
    input.metaStartedAtMs != null ? input.metaStartedAtMs : Math.round(endRef - durationMs);
  return { startedAtMs, endMs: Math.round(startedAtMs + durationMs) };
}
