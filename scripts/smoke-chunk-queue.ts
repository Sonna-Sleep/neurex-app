import assert from 'node:assert/strict';

import {
  addTask,
  bumpAttempt,
  type ChunkTask,
  CHUNK_INTERVAL_MS,
  chunkReady,
  confirmMatches,
  nextTask,
  removeTask,
} from '../src/lib/cloud/chunkQueue';

function task(sessionId: string, seq: number, over: Partial<ChunkTask> = {}): ChunkTask {
  return {
    sessionId,
    seq,
    path: `/sessions/${sessionId}/chunk${seq}.bin`,
    prefix: `u/${sessionId}`,
    bytes: 1000,
    sha256: 'abc',
    attempts: 0,
    ...over,
  };
}

// addTask + dedupe
let q: ChunkTask[] = [];
q = addTask(q, task('s', 0));
q = addTask(q, task('s', 1));
assert.equal(q.length, 2);
q = addTask(q, task('s', 0, { bytes: 2000 })); // same (s,0) → replace, not duplicate
assert.equal(q.length, 2);
assert.equal(q.find((t) => t.seq === 0)?.bytes, 2000);

// nextTask FIFO: oldest session, lowest seq
q = [];
q = addTask(q, task('s2', 0));
q = addTask(q, task('s1', 5));
q = addTask(q, task('s1', 2));
assert.equal(nextTask(q)?.sessionId, 's1');
assert.equal(nextTask(q)?.seq, 2);
assert.equal(nextTask([]), null);

// removeTask
q = removeTask(q, 's1', 2);
assert.equal(nextTask(q)?.seq, 5);

// bumpAttempt
q = bumpAttempt(q, 's1', 5);
assert.equal(q.find((t) => t.sessionId === 's1' && t.seq === 5)?.attempts, 1);

// confirmMatches — the delete gate
assert.equal(confirmMatches({ bytes: 1000, sha256: 'DEAD' }, { bytes_received: 1000, sha256: 'dead' }), true);
assert.equal(confirmMatches({ bytes: 1000, sha256: 'dead' }, { bytes_received: 999, sha256: 'dead' }), false);
assert.equal(confirmMatches({ bytes: 1000, sha256: 'dead' }, { bytes_received: 1000, sha256: 'beef' }), false);
assert.equal(confirmMatches({ bytes: 1000, sha256: 'dead' }, { sha256: 'dead' }), false, 'missing byte count → no delete');
assert.equal(confirmMatches({ bytes: 1000, sha256: 'dead' }, { bytes_received: 1000 }), false, 'missing hash → no delete');

// chunkReady
assert.equal(chunkReady(CHUNK_INTERVAL_MS), true);
assert.equal(chunkReady(CHUNK_INTERVAL_MS - 1), false);
assert.equal(chunkReady(0), false);
assert.equal(chunkReady(5000, 2000), true);

console.log('ALL CHUNK-QUEUE ASSERTIONS PASSED');
