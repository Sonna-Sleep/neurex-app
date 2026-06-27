// Worker for the segments-first upload pipeline. Persists the queue so chunks
// survive restarts + an offline stretch, drains it in order, and deletes a local
// chunk ONLY after the backend confirms an exact byte+hash match. Stops at the
// first failure (offline / mismatch) and resumes on the next drain (timer tick or
// reconnect) — so airplane mode just pauses uploads, never loses data.
//
// I/O (persistence, file delete, the actual upload) is injected so the drain loop
// is unit-testable; the file-backed store + the real /ingest uploader are the
// defaults wired in chunkUploadStore.ts (RN/expo-file-system) and the driver.

import {
  addTask,
  bumpAttempt,
  type ChunkTask,
  confirmMatches,
  nextTask,
  removeTask,
} from './chunkQueue';

/** Backend /ingest response. */
export type ServerConfirm = { bytes_received?: number; sha256?: string };
export type ChunkUploader = (task: ChunkTask) => Promise<ServerConfirm>;

export type QueueStore = {
  load(): ChunkTask[];
  save(queue: ChunkTask[]): void;
  /** Optional hook after the server confirms the exact bytes/hash. */
  confirmChunk?(task: ChunkTask): void;
  /** Delete the local chunk file after a confirmed upload. */
  deleteChunk(path: string): void;
};

export type DrainResult = { uploaded: number; kept: number; stopped: 'empty' | 'offline' | 'mismatch' };

export function enqueueChunk(store: QueueStore, task: ChunkTask): void {
  store.save(addTask(store.load(), task));
}

/**
 * Upload every queued chunk in order. For each: upload → if the server confirms an
 * exact byte+hash match, delete the local file + drop it from the queue; otherwise
 * keep it and stop (retry on the next drain). Persists after every chunk so a crash
 * mid-drain resumes cleanly. NEVER deletes a chunk the server didn't confirm.
 */
export async function drainQueue(upload: ChunkUploader, store: QueueStore): Promise<DrainResult> {
  let queue = store.load();
  let uploaded = 0;
  for (;;) {
    const task = nextTask(queue);
    if (!task) return { uploaded, kept: 0, stopped: 'empty' };

    let server: ServerConfirm;
    try {
      server = await upload(task);
    } catch {
      // Offline / transient error — keep the chunk, bump its attempt, retry later.
      queue = bumpAttempt(queue, task.sessionId, task.seq);
      store.save(queue);
      return { uploaded, kept: queue.length, stopped: 'offline' };
    }

    if (confirmMatches({ bytes: task.bytes, sha256: task.sha256 }, server)) {
      try {
        store.confirmChunk?.(task);
      } catch {
        /* manifest bookkeeping is best-effort; the server-confirmed chunk is safe */
      }
      try {
        store.deleteChunk(task.path);
      } catch {
        // already gone (a prior partial run) — fine; the confirmed bytes are safe in the cloud
      }
      queue = removeTask(queue, task.sessionId, task.seq);
      uploaded += 1;
      store.save(queue);
    } else {
      // Server received something different — do NOT delete; keep + stop so we
      // don't spin, and surface it (attempts) rather than silently drop data.
      queue = bumpAttempt(queue, task.sessionId, task.seq);
      store.save(queue);
      return { uploaded, kept: queue.length, stopped: 'mismatch' };
    }
  }
}
