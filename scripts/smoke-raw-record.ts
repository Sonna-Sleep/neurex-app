import assert from 'node:assert/strict';

import {
  EEG_SAMPLE_RATE_HZ,
  PACKET_END_HI,
  PACKET_END_LO,
  PACKET_START_HI,
  PACKET_START_LO,
  PKT_IDX_DATA,
  PKT_IDX_SEQ,
  PKT_IDX_TS,
  PKT_TRAILER_BYTES,
  RAW_STATUS_BYTES,
  SAMPLES_PER_PACKET,
  bytesPerFrame,
} from '../src/lib/ble/constants';
import { parsePacket } from '../src/lib/ble/packet';
import {
  encodeRawPacket,
  RAW_HEADER_BYTES,
  RAW_RECORD_BYTES,
  rawHeader,
  rawRecordBytes,
} from '../src/lib/ble/rawRecord';
import type { ActiveChannel } from '../src/lib/ble/scale';

const STREAM_CHANNELS = 4;
const FRAME_BYTES = bytesPerFrame(STREAM_CHANNELS);
const STATUS_OFF = PKT_IDX_DATA - RAW_STATUS_BYTES;
const MONTAGE: ActiveChannel[] = [
  { index: 0, streamIndex: 0, role: 'Fp1' },
  { index: 1, streamIndex: 1, role: 'Fp2' },
  { index: 2, streamIndex: 2, role: 'EOG-L' },
  { index: 3, streamIndex: 3, role: 'EOG-R' },
];

function checksumIndex(pkt: Uint8Array): number {
  return pkt.length - PKT_TRAILER_BYTES;
}

function finishPacket(pkt: Uint8Array): void {
  const checksumIdx = checksumIndex(pkt);
  let sum = 0;
  for (let i = PKT_IDX_SEQ; i < checksumIdx; i++) sum = (sum + pkt[i]) & 0xff;
  pkt[checksumIdx] = sum;
  pkt[checksumIdx + 1] = PACKET_END_HI;
  pkt[checksumIdx + 2] = PACKET_END_LO;
}

function makePacket(seq: number, baseMs: number): Uint8Array {
  const pkt = new Uint8Array(7 + SAMPLES_PER_PACKET * FRAME_BYTES + PKT_TRAILER_BYTES);
  pkt[0] = PACKET_START_HI;
  pkt[1] = PACKET_START_LO;
  pkt[PKT_IDX_SEQ] = seq;
  pkt[PKT_IDX_TS] = (baseMs >>> 24) & 0xff;
  pkt[PKT_IDX_TS + 1] = (baseMs >>> 16) & 0xff;
  pkt[PKT_IDX_TS + 2] = (baseMs >>> 8) & 0xff;
  pkt[PKT_IDX_TS + 3] = baseMs & 0xff;
  for (let s = 0; s < SAMPLES_PER_PACKET; s++) {
    const frame = STATUS_OFF + s * FRAME_BYTES;
    pkt[frame] = 0xc0;
    pkt[frame + 1] = 0x00;
    pkt[frame + 2] = s;
    for (let ch = 0; ch < STREAM_CHANNELS; ch++) {
      const code = (ch + 1) * 0x000100 + s;
      const co = frame + RAW_STATUS_BYTES + ch * 3;
      pkt[co] = (code >>> 16) & 0xff;
      pkt[co + 1] = (code >>> 8) & 0xff;
      pkt[co + 2] = code & 0xff;
    }
  }
  finishPacket(pkt);
  return pkt;
}

const h = rawHeader();
assert.equal(h.length, RAW_HEADER_BYTES);
assert.equal(String.fromCharCode(h[0], h[1], h[2], h[3]), 'NRX1');
const hv = new DataView(h.buffer, h.byteOffset, h.byteLength);
assert.equal(hv.getUint16(4, true), 1);
assert.equal(h[6], STREAM_CHANNELS);
assert.equal(h[7] & 1, 1);
assert.equal(hv.getUint16(8, true), EEG_SAMPLE_RATE_HZ);
assert.equal(hv.getUint16(10, true), RAW_RECORD_BYTES);
assert.equal(RAW_RECORD_BYTES, 24);
assert.equal(rawRecordBytes(STREAM_CHANNELS), 24);

const seq = 7;
const baseMs = 100000;
const pkt = makePacket(seq, baseMs);
assert.equal(pkt.length, 130);
const recs = encodeRawPacket(pkt, baseMs, seq);
assert.equal(recs.length, SAMPLES_PER_PACKET * RAW_RECORD_BYTES);
const dv = new DataView(recs.buffer, recs.byteOffset, recs.byteLength);
for (let s = 0; s < SAMPLES_PER_PACKET; s++) {
  const off: number = s * RAW_RECORD_BYTES;
  assert.equal(dv.getUint32(off, true), (baseMs + s * 4) >>> 0);
  assert.equal(recs[off + 4], seq);
  assert.equal(recs[off + 7], s);
  for (let ch = 0; ch < STREAM_CHANNELS; ch++) {
    assert.equal(dv.getInt32(off + 8 + ch * 4, true), (ch + 1) * 0x000100 + s);
  }
}

const parsed = parsePacket(pkt, 0, 1.0, MONTAGE, STREAM_CHANNELS);
if (!parsed.ok) throw new Error('parse failed');
assert.equal(dv.getInt32(8, true), parsed.packet.samples[0].fp1_uV);

const neg = makePacket(0, 0);
const co = STATUS_OFF + RAW_STATUS_BYTES;
neg[co] = 0xff;
neg[co + 1] = 0xff;
neg[co + 2] = 0xff;
finishPacket(neg);
const ndv = new DataView(encodeRawPacket(neg, 0, 0).buffer);
assert.equal(ndv.getInt32(8, true), -1);

console.log('ALL RAW RECORD ASSERTIONS PASSED');
