// File-backed persistence + I/O adapters for the 30-min chunked-upload pipeline
// (F2). The pure queue model lives in chunkQueue.ts and the drain loop in
// chunkUpload.ts; this module is the thin RN/expo-file-system layer that makes
// them durable:
//
//   - FileQueueStore: persists the upload queue to a single JSON file under the
//     documents dir, so queued-but-unconfirmed chunks survive an app restart and
//     an offline stretch (airplane mode), and deletes a confirmed chunk's local
//     file. Sync (expo-file-system's *Sync API) so it slots straight into the
//     QueueStore interface drainQueue expects.
//   - sha256Hex: the local chunk hash, computed over the EXACT bytes uploaded so
//     it can be compared to the backend's hashlib.sha256(body).hexdigest(). The
//     delete gate (confirmMatches) only frees a local chunk on an exact match.
//   - readSegBytes / segByteLength: read one closed segment fully into memory
//     (one at a time, drained sequentially) for hashing + upload.

import { File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';

import type { ChunkTask } from './chunkQueue';
import type { QueueStore } from './chunkUpload';

// One global queue across all sessions — nextTask() orders by (sessionId, seq),
// so a single file holds every pending chunk (a night is ~16 of them at 30 min).
const QUEUE_FILE = 'chunkqueue.json';

function queueFile(): File {
  return new File(Paths.document, QUEUE_FILE);
}

function isChunkTask(t: unknown): t is ChunkTask {
  const o = t as ChunkTask;
  return (
    !!o &&
    typeof o.sessionId === 'string' &&
    typeof o.seq === 'number' &&
    typeof o.path === 'string' &&
    typeof o.prefix === 'string' &&
    typeof o.bytes === 'number' &&
    typeof o.sha256 === 'string' &&
    typeof o.attempts === 'number'
  );
}

/** Durable, synchronous QueueStore backed by a single JSON file. A corrupt or
 * missing file reads as an empty queue (never throws into the drain loop). */
export const fileQueueStore: QueueStore = {
  load(): ChunkTask[] {
    try {
      const f = queueFile();
      if (!f.exists) return [];
      const parsed: unknown = JSON.parse(f.textSync());
      return Array.isArray(parsed) ? parsed.filter(isChunkTask) : [];
    } catch {
      return [];
    }
  },
  save(queue: ChunkTask[]): void {
    try {
      const f = queueFile();
      if (!f.exists) f.create();
      f.write(JSON.stringify(queue));
    } catch {
      // Best-effort: a failed persist just means we may re-attempt an already-
      // confirmed chunk next launch (idempotent upsert server-side) — never a loss.
    }
  },
  deleteChunk(path: string): void {
    // path is the seg file's file:// URI. Deleting a confirmed-in-cloud chunk is
    // how on-device storage is reclaimed mid-night.
    const f = new File(path);
    if (f.exists) f.delete();
  },
};

const HEX = '0123456789abcdef';

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    out += HEX[bytes[i] >> 4] + HEX[bytes[i] & 0x0f];
  }
  return out;
}

/** SHA-256 (lowercase hex) of the exact bytes — matches the backend's
 * hashlib.sha256(body).hexdigest(), so confirmMatches can gate the delete. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Pass the Uint8Array ITSELF, not its ArrayBuffer: expo-crypto's native Android
  // digest maps a typed array → Kotlin ByteArray, but a raw ArrayBuffer throws
  // "Cannot convert [object ArrayBuffer] to a Kotlin type" (caught on-device, not
  // by the fake-digest unit tests). The `as` only satisfies TS's BufferSource
  // typing (TS 5.7 rejects Uint8Array<ArrayBufferLike>); the runtime value is the
  // correct typed array. readSegBytes returns a clean whole-buffer view.
  const digest = await Crypto.digest(
    Crypto.CryptoDigestAlgorithm.SHA256,
    bytes as unknown as ArrayBuffer,
  );
  return toHex(digest);
}

/** Byte length of a closed segment file (0 if missing). */
export function segByteLength(uri: string): number {
  const f = new File(uri);
  return f.exists ? f.size : 0;
}

/** Read a whole closed segment into memory. Closed segments are immutable and
 * read one at a time during a drain, so a single ~3.5 MB buffer is safe. */
export function readSegBytes(uri: string): Uint8Array {
  const f = new File(uri);
  if (!f.exists) return new Uint8Array(0);
  const handle = f.open();
  try {
    return handle.readBytes(f.size);
  } finally {
    handle.close();
  }
}
