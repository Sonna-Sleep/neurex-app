// Pure model for the 30-min chunked-upload pipeline (Feature 2). No RN/BLE/IO so
// it's fully unit-testable; the file-backed persistence + the upload worker that
// drive it live in chunkUpload.ts.
//
// Flow: recording rolls a completed chunk file → addTask() → the worker uploads
// it to the backend /ingest endpoint → the server returns {bytes_received, sha256}
// → confirmMatches() gates deletion → removeTask() + delete the local file. The
// queue is persisted so chunks survive app restarts and an offline stretch
// (airplane mode) and auto-retry when connectivity returns. NEVER delete a local
// chunk before the server confirms an exact byte+hash match.

export type ChunkTask = {
  sessionId: string;
  /** Monotonic chunk index within the session — also the segNNNN.bin name + the
   *  idempotency key, so a retry overwrites the same object server-side. */
  seq: number;
  /** Local file path of the rolled chunk. */
  path: string;
  /** Storage prefix the chunk belongs to ({uid}/{label}). */
  prefix: string;
  bytes: number;
  sha256: string;
  attempts: number;
};

/** Add a chunk, de-duped by (sessionId, seq) — re-enqueuing the same chunk (e.g.
 *  after a crash mid-upload) replaces the existing entry rather than duplicating. */
export function addTask(queue: readonly ChunkTask[], task: ChunkTask): ChunkTask[] {
  const rest = queue.filter((t) => !(t.sessionId === task.sessionId && t.seq === task.seq));
  return [...rest, task];
}

/** Remove a chunk (after a confirmed upload + local delete). */
export function removeTask(queue: readonly ChunkTask[], sessionId: string, seq: number): ChunkTask[] {
  return queue.filter((t) => !(t.sessionId === sessionId && t.seq === seq));
}

/** FIFO next chunk to upload — oldest session, then lowest seq, so a night uploads
 *  in order and the backend assembles a contiguous run. */
export function nextTask(queue: readonly ChunkTask[]): ChunkTask | null {
  if (queue.length === 0) return null;
  return [...queue].sort((a, b) =>
    a.sessionId === b.sessionId ? a.seq - b.seq : a.sessionId < b.sessionId ? -1 : 1,
  )[0];
}

/** Mark a failed attempt (for backoff / surfacing a stuck chunk — never silent). */
export function bumpAttempt(queue: readonly ChunkTask[], sessionId: string, seq: number): ChunkTask[] {
  return queue.map((t) =>
    t.sessionId === sessionId && t.seq === seq ? { ...t, attempts: t.attempts + 1 } : t,
  );
}

/** The delete gate: the server's reported received bytes + hash must EXACTLY match
 *  the local chunk. Only then is it safe to delete the local copy. */
export function confirmMatches(
  local: { bytes: number; sha256: string },
  server: { bytes_received?: number; sha256?: string },
): boolean {
  return (
    typeof server.bytes_received === 'number' &&
    server.bytes_received === local.bytes &&
    typeof server.sha256 === 'string' &&
    server.sha256.toLowerCase() === local.sha256.toLowerCase()
  );
}

export const CHUNK_INTERVAL_MS = 30 * 60_000; // upload roughly every 30 min

/** Roll a new chunk once at least this much wall-clock (from the chunk's first
 *  sample ms) has been buffered. Driven off sample ms so it's lossless + works
 *  off BLE packets on iOS (no wall-clock timer needed). */
export function chunkReady(bufferedMs: number, intervalMs: number = CHUNK_INTERVAL_MS): boolean {
  return bufferedMs >= intervalMs;
}
