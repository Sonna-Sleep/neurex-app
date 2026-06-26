import assert from 'node:assert/strict';

import {
  estimateChunkedDurationMs,
  parseSegName,
  SEG_SAMPLE_BYTES,
  segObjectName,
  segThresholdBytes,
  shouldRollSeg,
} from '../src/lib/ble/segRoll';

// parseSegName is the inverse of segObjectName (recovery re-enqueues at real seq)
assert.equal(parseSegName('seg0000.bin'), 0);
assert.equal(parseSegName('seg0042.bin'), 42);
assert.equal(parseSegName('seg1234.bin'), 1234);
assert.equal(parseSegName('EEG.BIN'), null);
assert.equal(parseSegName('seg42.bin'), null); // wrong width
assert.equal(parseSegName('meta.json'), null);

// estimateChunkedDurationMs: (maxIndex+1) chunks of chunkSeconds each
assert.equal(estimateChunkedDurationMs(0, 1800), 1800 * 1000); // one 30-min chunk
assert.equal(estimateChunkedDurationMs(15, 1800), 16 * 1800 * 1000); // 8h
assert.equal(estimateChunkedDurationMs(-1, 1800), 0); // no segments → 0

// seg names match the backend convention (seg0000.bin ... seg1234.bin)
assert.equal(segObjectName(0), 'seg0000.bin');
assert.equal(segObjectName(7), 'seg0007.bin');
assert.equal(segObjectName(1234), 'seg1234.bin');

// threshold: whole-sample floor, never zero
assert.equal(segThresholdBytes(300, 250), 300 * 250 * 8); // 5 min @ 250 Hz
assert.equal(segThresholdBytes(0.001, 250), SEG_SAMPLE_BYTES); // tiny → at least one sample
assert.equal(segThresholdBytes(1, 250), 250 * 8);

// LOSSLESS rolling simulation: stream N whole packets (8 samples = 64 bytes each)
// through the roll rule and reconstruct the segments. The concatenation of all
// segments must equal the full input, every boundary must be on a packet edge,
// and every closed segment (all but the last) must have reached the threshold.
{
  const PACKET_BYTES = 8 * SEG_SAMPLE_BYTES; // 64
  const threshold = segThresholdBytes(2, 250); // 2 s = 4000 bytes ≈ 62.5 packets
  const totalPackets = 1000;

  const segments: number[] = []; // bytes per closed segment
  let curBytes = 0;
  let totalBytes = 0;

  const closeSeg = () => {
    segments.push(curBytes);
    // every packet in a segment is whole → segment size is a multiple of 64
    assert.equal(curBytes % PACKET_BYTES, 0, 'segment must be whole packets (no split sample)');
    curBytes = 0;
  };

  for (let i = 0; i < totalPackets; i++) {
    curBytes += PACKET_BYTES;
    totalBytes += PACKET_BYTES;
    // roll AFTER appending a whole packet
    if (shouldRollSeg(curBytes, threshold)) closeSeg();
  }
  if (curBytes > 0) closeSeg(); // final partial segment on stop

  const reassembled = segments.reduce((a, b) => a + b, 0);
  assert.equal(reassembled, totalBytes, 'segments must reassemble to the exact input (lossless)');
  assert.equal(reassembled, totalPackets * PACKET_BYTES);

  // every closed-by-threshold segment (all but the last) reached the threshold
  for (let i = 0; i < segments.length - 1; i++) {
    assert.ok(segments[i] >= threshold, `segment ${i} should have reached the threshold`);
    // and not absurdly over (at most one packet past the threshold)
    assert.ok(segments[i] < threshold + PACKET_BYTES, `segment ${i} overshoot ≤ one packet`);
  }
  assert.ok(segments.length >= 15, 'expected many segments for 1000 packets @ 2s threshold');
}

console.log('ALL SEG-ROLL ASSERTIONS PASSED');
