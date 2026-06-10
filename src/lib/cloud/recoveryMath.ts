// Pure timing math for crash-recovery — NO Expo/RN imports, so it's
// unit-testable in plain Node (scripts/smoke-recovery.ts). recovery.ts wraps
// this with the filesystem scan.

export const EEG_BYTES_PER_SAMPLE = 8; // uint32 ms + float32 µV — matches real.ts encoder

/** Recorded duration (ms) implied by an EEG.BIN byte count. */
export function durationMsFromBytes(sizeBytes: number, sampleRateHz: number): number {
  if (sizeBytes <= 0 || sampleRateHz <= 0) return 0;
  return (sizeBytes / EEG_BYTES_PER_SAMPLE / sampleRateHz) * 1000;
}

export type ReconstructInput = {
  sizeBytes: number;
  sampleRateHz: number;
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
  const durationMs = durationMsFromBytes(input.sizeBytes, input.sampleRateHz);
  const endRef = input.modificationTimeMs ?? input.nowMs;
  const startedAtMs =
    input.metaStartedAtMs != null ? input.metaStartedAtMs : Math.round(endRef - durationMs);
  return { startedAtMs, endMs: Math.round(startedAtMs + durationMs) };
}
