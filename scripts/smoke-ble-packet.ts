import assert from 'node:assert/strict';

import {
  BYTES_PER_FRAME,
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

function makePacket(seq = 7, baseMs = 1234): Uint8Array {
  const pkt = new Uint8Array(PACKET_SIZE);
  pkt[0] = PACKET_START_HI;
  pkt[1] = PACKET_START_LO;
  pkt[PKT_IDX_SEQ] = seq;
  pkt[PKT_IDX_TS] = (baseMs >>> 24) & 0xff;
  pkt[PKT_IDX_TS + 1] = (baseMs >>> 16) & 0xff;
  pkt[PKT_IDX_TS + 2] = (baseMs >>> 8) & 0xff;
  pkt[PKT_IDX_TS + 3] = baseMs & 0xff;
  for (let s = 0; s < SAMPLES_PER_PACKET; s++) {
    const o = PKT_IDX_DATA + s * BYTES_PER_FRAME;
    pkt[o] = 0xc0;
    pkt[o + 3] = s + 1;
  }
  let sum = 0;
  for (let i = PKT_IDX_SEQ; i < PKT_IDX_CHECKSUM; i++) sum = (sum + pkt[i]) & 0xff;
  pkt[PKT_IDX_CHECKSUM] = sum;
  pkt[PKT_IDX_CHECKSUM + 1] = PACKET_END_HI;
  pkt[PKT_IDX_CHECKSUM + 2] = PACKET_END_LO;
  return pkt;
}

const parsed = parsePacket(makePacket(), 3);

assert.equal(SAMPLES_PER_PACKET, 8);
assert.equal(PACKET_SIZE, 226);
assert.equal(parsed.ok, true);
if (!parsed.ok) throw new Error('unreachable');

assert.equal(parsed.packet.generation, 3);
assert.equal(parsed.packet.seq, 7);
assert.equal(parsed.packet.baseMs, 1234);
assert.equal(parsed.packet.samples.length, 8);
assert.equal(parsed.packet.samples[0].ms, 1234);
assert.equal(parsed.packet.samples[7].ms, 1241);

const badChecksum = makePacket();
badChecksum[PKT_IDX_CHECKSUM] ^= 0xff;
assert.deepEqual(parsePacket(badChecksum, 0), { ok: false, reason: 'checksum' });

// fp1Index channel selection: the device reports which channel carries FP1 (Fpz)
// over the Scale characteristic — 0=CH1 (YELLOW/GREEN/BLUE/WHITE/LT), 4=CH5 (RED).
// Build a packet where each channel holds a distinct value and prove parsePacket
// reads the channel the device reports, not a hardcoded CH1.
function makeMultiChannelPacket(): Uint8Array {
  const pkt = new Uint8Array(PACKET_SIZE);
  pkt[0] = PACKET_START_HI;
  pkt[1] = PACKET_START_LO;
  pkt[PKT_IDX_SEQ] = 1;
  for (let s = 0; s < SAMPLES_PER_PACKET; s++) {
    const o = PKT_IDX_DATA + s * BYTES_PER_FRAME;
    for (let ch = 0; ch < 8; ch++) {
      const code = (ch + 1) * 0x000100; // distinct positive int24: CH1=256, CH5=1280
      const co = o + ch * 3;
      pkt[co] = (code >>> 16) & 0xff;
      pkt[co + 1] = (code >>> 8) & 0xff;
      pkt[co + 2] = code & 0xff;
    }
  }
  let sum = 0;
  for (let i = PKT_IDX_SEQ; i < PKT_IDX_CHECKSUM; i++) sum = (sum + pkt[i]) & 0xff;
  pkt[PKT_IDX_CHECKSUM] = sum;
  pkt[PKT_IDX_CHECKSUM + 1] = PACKET_END_HI;
  pkt[PKT_IDX_CHECKSUM + 2] = PACKET_END_LO;
  return pkt;
}

const multi = makeMultiChannelPacket();
// uvPerLsb = 1 so fp1_uV equals the raw int24 code, making the channel obvious.
// Default fp1Index → CH1 (code 256).
const asCh1 = parsePacket(multi, 0, 1);
assert.equal(asCh1.ok, true);
if (!asCh1.ok) throw new Error('unreachable');
assert.equal(asCh1.packet.samples[0].fp1_uV, 256);
// RED reports fp1Index = 4 → CH5 (code 1280), on every sample in the packet.
const asCh5 = parsePacket(multi, 0, 1, 4);
assert.equal(asCh5.ok, true);
if (!asCh5.ok) throw new Error('unreachable');
assert.equal(asCh5.packet.samples[0].fp1_uV, 1280);
assert.equal(asCh5.packet.samples[SAMPLES_PER_PACKET - 1].fp1_uV, 1280);
// Out-of-range fp1Index falls back to CH1 (never reads out of the frame).
const asBad = parsePacket(multi, 0, 1, 99);
assert.equal(asBad.ok, true);
if (!asBad.ok) throw new Error('unreachable');
assert.equal(asBad.packet.samples[0].fp1_uV, 256);

console.log('ALL BLE PACKET ASSERTIONS PASSED');
