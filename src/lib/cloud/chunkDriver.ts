// Driver for the segments-first upload pipeline. The RN glue that ties the pure
// pieces together:
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
let backgroundDraining: Promise<void> | null = null;
const sessionDrains = new Map<string, Promise<void>>();
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
    try {
      const r = await LegacyFS.uploadAsync(url, fileUri, {
        httpMethod: 'POST',
        uploadType: LegacyFS.FileSystemUploadType.BINARY_CONTENT,
        // FOREGROUND so the awaited result carries the confirm body and we delete
        // in the same tick (the foreground service keeps the process alive on
        // Android). iOS background URLSession + deferred confirm is separate work.
        sessionType: LegacyFS.FileSystemSessionType.FOREGROUND,
        headers,
      });
      if (__DEV__) console.log(`[F2C] upload -> ${url} status=${r.status} body=${(r.body || '').slice(0, 160)}`);
      return { status: r.status, body: r.body };
    } catch (e) {
      console.warn(`[F2C] uploadAsync threw for ${fileUri}:`, (e as Error)?.message ?? e);
      throw e;
    }
  },
});

async function runDrain(sessionId?: string): Promise<void> {
  try {
    const queue = fileQueueStore.load();
    const queued = sessionId ? queue.filter((t) => t.sessionId === sessionId).length : queue.length;
    if (__DEV__) {
      console.log(`[F2C] drain start session=${sessionId ?? 'all'} queued=${queued}`);
    }
    const r = await drainQueue(uploader, fileQueueStore, { sessionId });
    if (__DEV__) {
      console.log(
        `[F2C] drain done session=${sessionId ?? 'all'} uploaded=${r.uploaded} kept=${r.kept} stopped=${r.stopped}`,
      );
    }
  } catch (e) {
    console.warn('[F2C] drain error:', e);
  }
}

/** Drain the queue once: upload each chunk in order, delete-after-confirm.
 * Session-scoped drains are independent from the background drain, so pressing
 * End never waits behind an old/stuck upload from another session. Drains for
 * the same session are still serialized to avoid double work on the same tail. */
export async function drainChunks(sessionId?: string): Promise<void> {
  if (sessionId) {
    for (;;) {
      const existing = sessionDrains.get(sessionId);
      if (!existing) break;
      await existing;
    }
    const p = runDrain(sessionId);
    sessionDrains.set(sessionId, p);
    try {
      await p;
    } finally {
      if (sessionDrains.get(sessionId) === p) sessionDrains.delete(sessionId);
    }
    return;
  }

  while (backgroundDraining) await backgroundDraining;
  const p = runDrain();
  backgroundDraining = p;
  try {
    await p;
  } finally {
    if (backgroundDraining === p) backgroundDraining = null;
  }
}

/** Hash + durably queue a closed segment, then try to upload it immediately.
 * Best-effort: on any failure the segment file stays on disk and is picked up by
 * the next drain / launch-time recovery — a chunk is never silently dropped. */
export async function enqueueSegment(seg: SegmentClosed): Promise<void> {
  if (__DEV__)
    console.log(
      `[F2C] segClosed idx=${seg.index} bytes=${seg.byteLength} enabled=${CHUNKED_UPLOAD_ENABLED} hasCtx=${!!ctx}`,
    );
  if (!CHUNKED_UPLOAD_ENABLED || !ctx || seg.byteLength <= 0) return;
  const session = ctx;
  const p = (async () => {
    try {
      const auth = await sessionAuth();
      if (!auth) {
        console.warn('[F2C] enqueue: NO AUTH (signed out / no cached session) — seg kept on disk');
        return; // logged out — leave on disk for recovery
      }
      const bytes = readSegBytes(seg.uri);
      if (bytes.length === 0) {
        console.warn(`[F2C] enqueue: seg ${seg.index} read 0 bytes at ${seg.uri}`);
        return;
      }
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
      if (__DEV__) console.log(`[F2C] enqueued seq=${seg.index} bytes=${bytes.length} prefix=${prefix}`);
    } catch (e) {
      console.warn('[F2C] enqueue failed (kept on disk):', (e as Error)?.message ?? e);
    }
  })();
  pendingEnqueues.add(p);
  await p;
  pendingEnqueues.delete(p);
  void drainChunks(); // upload now (also covers platforms where the timer sleeps)
}

/** Begin driving uploads for a session. No-op only when the legacy EEG.BIN
 * fallback is explicitly enabled. */
export function startChunkDriver(c: DriverCtx): void {
  if (__DEV__)
    console.log(
      `[F2C] startChunkDriver enabled=${CHUNKED_UPLOAD_ENABLED} chunkSec=${CHUNK_SECONDS} session=${c.sessionId}`,
    );
  if (!CHUNKED_UPLOAD_ENABLED) return;
  ctx = c;
  if (timer) clearInterval(timer);
  timer = setInterval(() => void drainChunks(), DRAIN_INTERVAL_MS);
  void drainChunks(); // sweep anything left queued from a previous run
}

/** Stop driving: wait for any in-flight enqueue (so the final segment is queued),
 * then do one last drain. Leaves anything unconfirmed queued for recovery. */
export async function stopChunkDriver(sessionId?: string): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  ctx = null;
  if (pendingEnqueues.size > 0) await Promise.allSettled([...pendingEnqueues]);
  await drainChunks(sessionId);
}
