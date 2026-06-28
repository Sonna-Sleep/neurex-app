import assert from 'node:assert/strict';

import type { ChunkTask } from '../src/lib/cloud/chunkQueue';
import {
  type ChunkUploader,
  drainQueue,
  enqueueChunk,
  type QueueStore,
} from '../src/lib/cloud/chunkUpload';

function makeStore(initial: ChunkTask[] = []) {
  let q = initial.map((t) => ({ ...t }));
  const deleted: string[] = [];
  const store: QueueStore = {
    load: () => q.map((t) => ({ ...t })),
    save: (nq) => {
      q = nq.map((t) => ({ ...t }));
    },
    deleteChunk: (p) => {
      deleted.push(p);
    },
  };
  return { store, getQ: () => q, deleted };
}

function task(seq: number): ChunkTask {
  return { sessionId: 's', seq, path: `/c${seq}.bin`, prefix: 'u/s', bytes: 1000, sha256: 'aa', attempts: 0 };
}

const okUpload: ChunkUploader = async () => ({ bytes_received: 1000, sha256: 'aa' });

(async () => {
  // all confirmed → uploaded + deleted + queue empty
  {
    const { store, getQ, deleted } = makeStore([task(0), task(1), task(2)]);
    const r = await drainQueue(okUpload, store);
    assert.equal(r.uploaded, 3);
    assert.equal(r.stopped, 'empty');
    assert.equal(getQ().length, 0);
    assert.deepEqual(deleted, ['/c0.bin', '/c1.bin', '/c2.bin']);
  }

  // offline → nothing uploaded/deleted, kept for retry; then resume online
  {
    const { store, getQ, deleted } = makeStore([task(0), task(1)]);
    const fail: ChunkUploader = async () => {
      throw new Error('offline');
    };
    let r = await drainQueue(fail, store);
    assert.equal(r.uploaded, 0);
    assert.equal(r.stopped, 'offline');
    assert.equal(getQ().length, 2);
    assert.equal(deleted.length, 0);
    r = await drainQueue(okUpload, store); // connectivity back
    assert.equal(r.uploaded, 2);
    assert.equal(getQ().length, 0);
  }

  // server confirms a DIFFERENT byte count → never delete; keep + stop
  {
    const { store, getQ, deleted } = makeStore([task(0)]);
    const bad: ChunkUploader = async () => ({ bytes_received: 999, sha256: 'aa' });
    const r = await drainQueue(bad, store);
    assert.equal(r.uploaded, 0);
    assert.equal(r.stopped, 'mismatch');
    assert.equal(getQ().length, 1, 'unconfirmed chunk stays queued');
    assert.equal(deleted.length, 0, 'NEVER delete before confirm');
  }

  // session-scoped drain: a stale broken session must not block the current one
  {
    const stale = { ...task(0), sessionId: 'old', path: '/old0.bin' };
    const current = { ...task(0), sessionId: 'current', path: '/current0.bin' };
    const { store, getQ, deleted } = makeStore([stale, current]);
    const upload: ChunkUploader = async (t) => {
      if (t.sessionId === 'old') throw new Error('old upload is stuck');
      return { bytes_received: t.bytes, sha256: t.sha256 };
    };
    const r = await drainQueue(upload, store, { sessionId: 'current' });
    assert.equal(r.uploaded, 1);
    assert.equal(r.stopped, 'empty');
    assert.deepEqual(deleted, ['/current0.bin']);
    assert.equal(getQ().length, 1);
    assert.equal(getQ()[0].sessionId, 'old');
  }

  // enqueueChunk persists + dedupes
  {
    const { store, getQ } = makeStore();
    enqueueChunk(store, task(0));
    enqueueChunk(store, task(0));
    assert.equal(getQ().length, 1);
  }

  console.log('ALL CHUNK-UPLOAD ASSERTIONS PASSED');
})();
