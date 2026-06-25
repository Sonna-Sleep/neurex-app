import assert from 'node:assert/strict';

import {
  BYTES_PER_FRAME,
  EEG_SAMPLE_RATE_HZ,
  PACKET_END_HI,
  PACKET_END_LO,
  PACKET_SIZE,
  PACKET_START_HI,
  PACKET_START_LO,
  PKT_IDX_CHECKSUM,
  PKT_IDX_DATA,
  PKT_IDX_SEQ,
  PKT_IDX_TS,
  SAMPLES_PER_PACKET,
} from '../src/lib/ble/constants';
import { parsePacket } from '../src/lib/ble/packet';
import {
  encodeRawPacket,
  RAW_HEADER_BYTES,
  RAW_N_CHANNELS,
  RAW_RECORD_BYTES,
  rawHeader,
} from '../src/lib/ble/rawRecord';

// Frame status starts 3 bytes before the first channel sample (PKT_IDX_DATA).
const STATUS_OFF = PKT_IDX_DATA - 3;

function setChecksum(pkt: Uint8Array): void {
  let sum = 0;
  for (let i = PKT_IDX_SEQ; i < PKT_IDX_CHECKSUM; i++) sum = (sum + pkt[i]) & 0xff;
  pkt[PKT_IDX_CHECKSUM] = sum;
  pkt[PKT_IDX_CHECKSUM + 1] = PACKET_END_HI;
  pkt[PKT_IDX_CHECKSUM + 2] = PACKET_END_LO;
}

// All 8 channels distinct per channel AND per sample, status' last byte = s.
function makePacket(seq: number, baseMs: number): Uint8Array {
  const pkt = new Uint8Array(PACKET_SIZE);
  pkt[0] = PACKET_START_HI;
  pkt[1] = PACKET_START_LO;
  pkt[PKT_IDX_SEQ] = seq;
  pkt[PKT_IDX_TS] = (baseMs >>> 24) & 0xff;
  pkt[PKT_IDX_TS + 1] = (baseMs >>> 16) & 0xff;
  pkt[PKT_IDX_TS + 2] = (baseMs >>> 8) & 0xff;
  pkt[PKT_IDX_TS + 3] = baseMs & 0xff;
  for (let s = 0; s < SAMPLES_PER_PACKET; s++) {
    const frame = STATUS_OFF + s * BYTES_PER_FRAME;
    pkt[frame] = 0xc0;
    pkt[frame + 1] = 0x00;
    pkt[frame + 2] = s; // status last byte = s
    for (let ch = 0; ch < 8; ch++) {
      const code = (ch + 1) * 0x000100 + s; // distinct positive int24
      const co = frame + 3 + ch * 3;
      pkt[co] = (code >>> 16) & 0xff;
      pkt[co + 1] = (code >>> 8) & 0xff;
      pkt[co + 2] = code & 0xff;
    }
  }
  setChecksum(pkt);
  return pkt;
}

// ── Header: must byte-match backend decoder.parse_raw_header (NRX1 v1) ──
const h = rawHeader();
assert.equal(h.length, RAW_HEADER_BYTES);
assert.equal(String.fromCharCode(h[0], h[1], h[2], h[3]), 'NRX1');
const hv = new DataView(h.buffer, h.byteOffset, h.byteLength);
assert.equal(hv.getUint16(4, true), 1); // schema_ver
assert.equal(h[6], 8); // n_channels
assert.equal(h[7] & 1, 1); // STATUS_PRESENT
assert.equal(hv.getUint16(8, true), EEG_SAMPLE_RATE_HZ); // nominal_fs
assert.equal(hv.getUint16(10, true), RAW_RECORD_BYTES); // record_bytes
assert.equal(RAW_RECORD_BYTES, 40); // 4 ms + 1 seq + 3 status + 8*4 counts
assert.equal(RAW_N_CHANNELS, 8);

// ── Records: ms/seq/status/all-8-channel int32 LE ──
const seq = 7;
const baseMs = 100000;
const pkt = makePacket(seq, baseMs);
const recs = encodeRawPacket(pkt, baseMs, seq);
assert.equal(recs.length, SAMPLES_PER_PACKET * RAW_RECORD_BYTES);
const dv = new DataView(recs.buffer, recs.byteOffset, recs.byteLength);
for (let s = 0; s < SAMPLES_PER_PACKET; s++) {
  const off: number = s * RAW_RECORD_BYTES;
  assert.equal(dv.getUint32(off, true), (baseMs + s) >>> 0); // ms matches eeg.bin
  assert.equal(recs[off + 4], seq); // seq
  assert.equal(recs[off + 7], s); // status last byte preserved
  for (let ch = 0; ch < 8; ch++) {
    assert.equal(dv.getInt32(off + 8 + ch * 4, true), (ch + 1) * 0x000100 + s);
  }
}

// ── Cross-check vs parsePacket: the fp1 channel in raw × uvPerLsb == fp1_uV ──
// (this is what makes raw_to_eeg_bin reproduce the app's eeg.bin)
const parsed = parsePacket(pkt, 0, 1.0, 4); // fp1Index = 4 (RED)
if (!parsed.ok) throw new Error('parse failed');
assert.equal(dv.getInt32(0 + 8 + 4 * 4, true) * 1.0, parsed.packet.samples[0].fp1_uV);

// ── Negative int24 sign-extends to int32 ──
const neg = makePacket(0, 0);
const co = STATUS_OFF + 3; // channel 0, sample 0
neg[co] = 0xff;
neg[co + 1] = 0xff;
neg[co + 2] = 0xff; // -1 int24
setChecksum(neg);
const ndv = new DataView(encodeRawPacket(neg, 0, 0).buffer);
assert.equal(ndv.getInt32(8, true), -1);

console.log('ALL RAW RECORD ASSERTIONS PASSED');
