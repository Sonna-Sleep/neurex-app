import assert from 'node:assert/strict';

import {
  BYTES_PER_FRAME,
  EEG_SAMPLE_INTERVAL_MS,
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
import type { ActiveChannel } from '../src/lib/ble/scale';

const MONTAGE: ActiveChannel[] = [
  { index: 0, role: 'Fp1' },
  { index: 1, role: 'Fp2' },
  { index: 2, role: 'EOG-L' },
  { index: 3, role: 'EOG-R' },
];

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

const parsed = parsePacket(makePacket(), 3, 1, MONTAGE);

assert.equal(SAMPLES_PER_PACKET, 8);
assert.equal(PACKET_SIZE, 226);
assert.equal(parsed.ok, true);
if (!parsed.ok) throw new Error('unreachable');

assert.equal(parsed.packet.generation, 3);
assert.equal(parsed.packet.seq, 7);
assert.equal(parsed.packet.baseMs, 1234);
assert.equal(parsed.packet.samples.length, 8);
assert.equal(parsed.packet.samples[0].ms, 1234);
assert.equal(parsed.packet.samples[1].ms, 1234 + EEG_SAMPLE_INTERVAL_MS);
assert.equal(parsed.packet.samples[7].ms, 1234 + 7 * EEG_SAMPLE_INTERVAL_MS);

const badChecksum = makePacket();
badChecksum[PKT_IDX_CHECKSUM] ^= 0xff;
assert.deepEqual(parsePacket(badChecksum, 0, 1, MONTAGE), { ok: false, reason: 'checksum' });

// Four-channel montage: every active role comes from the schema-v3 scale metadata.
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
const asMontage = parsePacket(multi, 0, 1, MONTAGE);
assert.equal(asMontage.ok, true);
if (!asMontage.ok) throw new Error('unreachable');
assert.equal(asMontage.packet.samples[0].fp1_uV, 256);
assert.equal(asMontage.packet.samples[0].channels['Fp2'], 512);
assert.equal(asMontage.packet.samples[0].channels['EOG-L'], 768);
assert.equal(asMontage.packet.samples[0].channels['EOG-R'], 1024);

console.log('ALL BLE PACKET ASSERTIONS PASSED');
