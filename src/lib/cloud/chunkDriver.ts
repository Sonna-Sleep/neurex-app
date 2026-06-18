// Driver for the 30-min chunked-upload pipeline (Feature 2). The RN glue that
// ties the pure pieces together:
//
//   real.ts rolls a segNNNN.bin every CHUNK_SECONDS → onSegmentClosed →
//   enqueueSegment() hashes it + queues it (durably) → drainChunks() uploads it
//   to /ingest → the server returns {bytes_received, sha256} → confirmMatches()
//   gates the delete → the local segment is removed, reclaiming space.
//
// Drains are triggered three ways so the night uploads with the screen off and
// recovers from an outage: immediately when a segment closes, on a CHUNK_SECONDS
// backstop timer (alive in the background under the Android foreground service),
// and on a BLE reconnect (call drainChunks() after the link returns). An offline
// drain just keeps everything queued and retries next trigger — never deletes
// unconfirmed data.

import * as LegacyFS from 'expo-file-system/legacy';

import { getSupabase } from '../auth/supabase';
import { CHUNK_SECONDS, CHUNKED_UPLOAD_ENABLED, MODAL_ENDPOINT_URL } from '../config';
import type { SegmentClosed } from '../ble/types';
import { addTask } from './chunkQueue';
import { drainQueue } from './chunkUpload';
import { fileQueueStore, readSegBytes, sha256Hex } from './chunkUploadStore';
import { makeIngestUploader } from './chunkUploader';
import { readableLabelStable } from './cloudSync';

type DriverCtx = { sessionId: string; startedAtMs: number; serial?: string | null };

let ctx: DriverCtx | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let draining = false;
const pendingEnqueues = new Set<Promise<void>>();

// Backstop drain cadence = one chunk interval (>= 30 s). Each closed segment also
// triggers an immediate drain, so this only matters when an enqueue's drain was
// offline or the seg roll itself is slow.
const DRAIN_INTERVAL_MS = Math.max(30_000, CHUNK_SECONDS * 1000);

/** Cached session uid + access token. getSession() reads from local storage (no
 * network for the uid), so the owner prefix resolves even in airplane mode. */
async function sessionAuth(): Promise<{ uid: string; token: string } | null> {
  const sb = getSupabase();
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getSession();
    const s = data.session;
    if (!s?.user?.id || !s.access_token) return null;
    return { uid: s.user.id, token: s.access_token };
  } catch {
    return null;
  }
}

const uploader = makeIngestUploader({
  endpoint: MODAL_ENDPOINT_URL,
  getToken: async () => (await sessionAuth())?.token ?? null,
  upload: async (url, fileUri, headers) => {
    const r = await LegacyFS.uploadAsync(url, fileUri, {
      httpMethod: 'POST',
      uploadType: LegacyFS.FileSystemUploadType.BINARY_CONTENT,
      // FOREGROUND so the awaited result carries the confirm body and we delete
      // in the same tick (the foreground service keeps the process alive on
      // Android). iOS background URLSession + deferred confirm is separate work.
      sessionType: LegacyFS.FileSystemSessionType.FOREGROUND,
      headers,
    });
    return { status: r.status, body: r.body };
  },
});

/** Drain the queue once: upload each chunk in order, delete-after-confirm. Safe
 * to call concurrently — overlapping calls coalesce via the `draining` guard. */
export async function drainChunks(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    await drainQueue(uploader, fileQueueStore);
  } catch (e) {
    if (__DEV__) console.warn('[chunkDriver] drain error:', e);
  } finally {
    draining = false;
  }
}

/** Hash + durably queue a closed segment, then try to upload it immediately.
 * Best-effort: on any failure the segment file stays on disk and is picked up by
 * the next drain / launch-time recovery — a chunk is never silently dropped. */
export async function enqueueSegment(seg: SegmentClosed): Promise<void> {
  if (!CHUNKED_UPLOAD_ENABLED || !ctx || seg.byteLength <= 0) return;
  const session = ctx;
  const p = (async () => {
    try {
      const auth = await sessionAuth();
      if (!auth) return; // logged out — leave on disk for recovery
      const bytes = readSegBytes(seg.uri);
      if (bytes.length === 0) return;
      const sha256 = await sha256Hex(bytes);
      const prefix = `${auth.uid}/${readableLabelStable(
        session.sessionId,
        session.startedAtMs,
        session.serial ?? undefined,
      )}`;
      fileQueueStore.save(
        addTask(fileQueueStore.load(), {
          sessionId: session.sessionId,
          seq: seg.index,
          path: seg.uri,
          prefix,
          bytes: bytes.length,
          sha256,
          attempts: 0,
        }),
      );
    } catch (e) {
      if (__DEV__) console.warn('[chunkDriver] enqueue failed (kept on disk):', e);
    }
  })();
  pendingEnqueues.add(p);
  await p;
  pendingEnqueues.delete(p);
  void drainChunks(); // upload now (also covers platforms where the timer sleeps)
}

/** Begin driving uploads for a session. No-op when chunked upload is disabled. */
export function startChunkDriver(c: DriverCtx): void {
  if (!CHUNKED_UPLOAD_ENABLED) return;
  ctx = c;
  if (timer) clearInterval(timer);
  timer = setInterval(() => void drainChunks(), DRAIN_INTERVAL_MS);
  void drainChunks(); // sweep anything left queued from a previous run
}

/** Stop driving: wait for any in-flight enqueue (so the final segment is queued),
 * then do one last drain. Leaves anything unconfirmed queued for recovery. */
export async function stopChunkDriver(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  ctx = null;
  if (pendingEnqueues.size > 0) await Promise.allSettled([...pendingEnqueues]);
  await drainChunks();
}
