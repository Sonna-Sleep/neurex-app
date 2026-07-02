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
  bytesPerFrame,
} from '../src/lib/ble/constants';
import { parsePacket } from '../src/lib/ble/packet';
import {
  encodeRawPacket,
  RAW_HEADER_BYTES,
  RAW_N_CHANNELS,
  RAW_RECORD_BYTES,
  rawHeader,
  rawRecordBytes,
} from '../src/lib/ble/rawRecord';
import type { ActiveChannel } from '../src/lib/ble/scale';

// Frame status starts 3 bytes before the first channel sample (PKT_IDX_DATA).
const STATUS_OFF = PKT_IDX_DATA - 3;
const MONTAGE: ActiveChannel[] = [
  { index: 0, role: 'Fp1' },
  { index: 1, role: 'Fp2' },
  { index: 2, role: 'EOG-L' },
  { index: 3, role: 'EOG-R' },
];

function setChecksum(pkt: Uint8Array): void {
  let sum = 0;
  for (let i = PKT_IDX_SEQ; i < PKT_IDX_CHECKSUM; i++) sum = (sum + pkt[i]) & 0xff;
  pkt[PKT_IDX_CHECKSUM] = sum;
  pkt[PKT_IDX_CHECKSUM + 1] = PACKET_END_HI;
  pkt[PKT_IDX_CHECKSUM + 2] = PACKET_END_LO;
}

function setDynamicChecksum(pkt: Uint8Array, checksumIdx: number): void {
  let sum = 0;
  for (let i = PKT_IDX_SEQ; i < checksumIdx; i++) sum = (sum + pkt[i]) & 0xff;
  pkt[checksumIdx] = sum;
  pkt[checksumIdx + 1] = PACKET_END_HI;
  pkt[checksumIdx + 2] = PACKET_END_LO;
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

function makeCompactPacket(seq: number, baseMs: number, nChannels: number): Uint8Array {
  const frameBytes = bytesPerFrame(nChannels);
  const checksumIdx = 7 + SAMPLES_PER_PACKET * frameBytes;
  const pkt = new Uint8Array(checksumIdx + 3);
  pkt[0] = PACKET_START_HI;
  pkt[1] = PACKET_START_LO;
  pkt[PKT_IDX_SEQ] = seq;
  pkt[PKT_IDX_TS] = (baseMs >>> 24) & 0xff;
  pkt[PKT_IDX_TS + 1] = (baseMs >>> 16) & 0xff;
  pkt[PKT_IDX_TS + 2] = (baseMs >>> 8) & 0xff;
  pkt[PKT_IDX_TS + 3] = baseMs & 0xff;
  for (let s = 0; s < SAMPLES_PER_PACKET; s++) {
    const frame = STATUS_OFF + s * frameBytes;
    pkt[frame] = 0xc0;
    pkt[frame + 1] = 0x00;
    pkt[frame + 2] = s;
    for (let ch = 0; ch < nChannels; ch++) {
      const code = (ch + 1) * 0x000100 + s;
      const co = frame + 3 + ch * 3;
      pkt[co] = (code >>> 16) & 0xff;
      pkt[co + 1] = (code >>> 8) & 0xff;
      pkt[co + 2] = code & 0xff;
    }
  }
  setDynamicChecksum(pkt, checksumIdx);
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
const h4 = rawHeader(EEG_SAMPLE_RATE_HZ, 4);
const h4v = new DataView(h4.buffer, h4.byteOffset, h4.byteLength);
assert.equal(h4[6], 4); // compact n_channels
assert.equal(h4v.getUint16(10, true), 24); // record_bytes
assert.equal(rawRecordBytes(4), 24);

// ── Legacy records: ms/seq/status/8-channel int32 LE ──
const seq = 7;
const baseMs = 100000;
const pkt = makePacket(seq, baseMs);
const recs = encodeRawPacket(pkt, baseMs, seq);
assert.equal(recs.length, SAMPLES_PER_PACKET * RAW_RECORD_BYTES);
const dv = new DataView(recs.buffer, recs.byteOffset, recs.byteLength);
for (let s = 0; s < SAMPLES_PER_PACKET; s++) {
  const off: number = s * RAW_RECORD_BYTES;
  assert.equal(dv.getUint32(off, true), (baseMs + s * 4) >>> 0); // ms matches eeg.bin
  assert.equal(recs[off + 4], seq); // seq
  assert.equal(recs[off + 7], s); // status last byte preserved
  for (let ch = 0; ch < 8; ch++) {
    assert.equal(dv.getInt32(off + 8 + ch * 4, true), (ch + 1) * 0x000100 + s);
  }
}

// ── Cross-check vs parsePacket: raw CH1 × uvPerLsb == live Fp1 convenience ──
const parsed = parsePacket(pkt, 0, 1.0, MONTAGE);
if (!parsed.ok) throw new Error('parse failed');
assert.equal(dv.getInt32(0 + 8 + 0 * 4, true) * 1.0, parsed.packet.samples[0].fp1_uV);

// ── Compact v4 records: 4 stream channels, 24 bytes/sample ────────────────
const compactMontage: ActiveChannel[] = [
  { index: 0, streamIndex: 0, role: 'Fp1' },
  { index: 1, streamIndex: 1, role: 'Fp2' },
  { index: 2, streamIndex: 2, role: 'EOG-L' },
  { index: 3, streamIndex: 3, role: 'EOG-R' },
];
const compactPkt = makeCompactPacket(9, 200000, 4);
assert.equal(compactPkt.length, 130);
const compactParsed = parsePacket(compactPkt, 0, 1.0, compactMontage, 4);
if (!compactParsed.ok) throw new Error('compact parse failed');
const compactRecs = encodeRawPacket(compactPkt, 200000, 9, 4);
assert.equal(compactRecs.length, SAMPLES_PER_PACKET * 24);
const cdv = new DataView(compactRecs.buffer, compactRecs.byteOffset, compactRecs.byteLength);
assert.equal(cdv.getUint32(0, true), 200000);
assert.equal(compactRecs[7], 0);
assert.equal(cdv.getInt32(8, true), 0x000100);
assert.equal(cdv.getInt32(20, true), 0x000400);
assert.equal(cdv.getInt32(24 + 8, true), 0x000101);
assert.equal(cdv.getInt32(24 + 20, true), 0x000401);
assert.equal(cdv.getInt32(8, true), compactParsed.packet.samples[0].channels.Fp1);

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
