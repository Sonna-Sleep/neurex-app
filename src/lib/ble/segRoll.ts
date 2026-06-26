// Pure rolling-segment boundary logic for the segments-first upload pipeline. No
// RN/IO, so the losslessness of the segment boundaries is provable in a plain
// Node test before it ever touches a device.
//
// The recording is written as a sequence of segNNNN.bin files instead of one
// growing EEG.BIN. A segment is closed (and handed to the upload queue) once it
// reaches the byte threshold — but ONLY on a whole-packet boundary, because the
// writer appends one decoded packet (8 samples) at a time. Rolling between
// packets guarantees no sample is ever split across two segments, so the
// backend's ordered concatenation of the segments is byte-identical to the
// single-file recording. Delete-after-confirm then reclaims each segment's space.

export const SEG_SAMPLE_BYTES = 8; // uint32 ms + float32 µV, matches real.ts encoder

/** Cloud + local object name for segment `index` — matches the backend's
 * _seg_object_name and supabase_admin's _SEG_RE so a chunk uploaded mid-night
 * assembles exactly like an end-of-night segment. */
export function segObjectName(index: number): string {
  return `seg${String(index).padStart(4, '0')}.bin`;
}

/** Target bytes per segment for `seconds` of audio at `sampleRateHz`, floored to
 * a whole sample. Always at least one sample so a tiny debug interval still rolls. */
export function segThresholdBytes(
  seconds: number,
  sampleRateHz: number,
  sampleBytes: number = SEG_SAMPLE_BYTES,
): number {
  return Math.max(sampleBytes, Math.floor(seconds * sampleRateHz) * sampleBytes);
}

/** Roll the current segment once it has reached the threshold. Checked AFTER a
 * whole packet is appended, so the boundary always lands between packets. */
export function shouldRollSeg(currentSegBytes: number, thresholdBytes: number): boolean {
  return currentSegBytes >= thresholdBytes;
}

/** Parse a segment index back out of a segNNNN.bin name (null if it doesn't
 * match), so launch-time recovery can re-enqueue orphan segments at their real
 * upload seq after a crash. */
export function parseSegName(name: string): number | null {
  const m = /^seg(\d{4})\.bin$/.exec(name);
  return m ? parseInt(m[1], 10) : null;
}

/** Best-effort recording length for a crash-recovered chunked session, from its
 * highest segment index: each closed segment holds ~chunkSeconds of audio, so
 * (maxIndex + 1) chunks approximates the night. Used only to fill the journal
 * row's duration on recovery — staging itself reads the real assembled samples. */
export function estimateChunkedDurationMs(maxIndex: number, chunkSeconds: number): number {
  return Math.max(0, (maxIndex + 1) * chunkSeconds * 1000);
}
