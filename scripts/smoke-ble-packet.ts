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

console.log('ALL BLE PACKET ASSERTIONS PASSED');
