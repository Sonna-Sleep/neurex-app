import assert from 'node:assert/strict';

import { buildStreamStatsPayload } from '../src/lib/cloud/streamStatsPayload';

const payload = buildStreamStatsPayload({
  sessionId: 'session-1',
  startedAtMs: 1_000,
  endMs: 61_000,
  stopReason: 'manual',
  stats: {
    packets: 100,
    samples: 15_000,
    drops: 2,
    dupSkips: 1,
    deviceReboots: 0,
    timeGapCount: 2,
    totalTimeGapMs: 64_701,
    maxTimeGapMs: 61_148,
    lastSeq: 42,
    generation: 3,
    lastBaseMs: 60_000,
    rawRequired: true,
    rawOpened: true,
    rawBytesWritten: 600_016,
    rawClosed: true,
    rawUploaded: true,
    rawSha256: 'abc123',
    rawFailureReason: null,
  },
  chunkedUploadEnabled: true,
  chunkSeconds: 1_800,
  queuedChunkCount: 0,
  confirmedChunkCount: 4,
  confirmedRawChunkCount: 2,
  appVersion: '0.1.0',
  appBuild: 21,
  createdAtMs: 62_000,
});

assert.equal(payload.schemaVer, 1);
assert.equal(payload.sessionId, 'session-1');
assert.equal(payload.durationMs, 60_000);
assert.equal(payload.stopReason, 'manual');
assert.equal(payload.packets, 100);
assert.equal(payload.samples, 15_000);
assert.equal(payload.drops, 2);
assert.equal(payload.dupSkips, 1);
assert.equal(payload.deviceReboots, 0);
assert.equal(payload.timeGapCount, 2);
assert.equal(payload.totalTimeGapMs, 64_701);
assert.equal(payload.maxTimeGapMs, 61_148);
assert.equal(payload.timeGapThresholdMs, 1_000);
assert.equal(payload.lastSeq, 42);
assert.equal(payload.lastBaseMs, 60_000);
assert.equal(payload.chunkedUploadEnabled, true);
assert.equal(payload.chunkSeconds, 1_800);
assert.equal(payload.queuedChunkCount, 0);
assert.equal(payload.confirmedChunkCount, 4);
assert.equal(payload.confirmedRawChunkCount, 2);
assert.equal(payload.rawRequired, true);
assert.equal(payload.rawOpened, true);
assert.equal(payload.rawBytesWritten, 600_016);
assert.equal(payload.rawClosed, true);
assert.equal(payload.rawUploaded, true);
assert.equal(payload.rawSha256, 'abc123');
assert.equal(payload.rawFailureReason, null);
assert.equal(payload.appVersion, '0.1.0');
assert.equal(payload.appBuild, 21);

console.log('stream_stats payload smoke passed');
