import assert from 'node:assert/strict';

import {
  EEG_SAMPLE_INTERVAL_MS,
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

function makePacket(seq = 7, baseMs = 1234): Uint8Array {
  const pkt = new Uint8Array(7 + SAMPLES_PER_PACKET * FRAME_BYTES + PKT_TRAILER_BYTES);
  pkt[0] = PACKET_START_HI;
  pkt[1] = PACKET_START_LO;
  pkt[PKT_IDX_SEQ] = seq;
  pkt[PKT_IDX_TS] = (baseMs >>> 24) & 0xff;
  pkt[PKT_IDX_TS + 1] = (baseMs >>> 16) & 0xff;
  pkt[PKT_IDX_TS + 2] = (baseMs >>> 8) & 0xff;
  pkt[PKT_IDX_TS + 3] = baseMs & 0xff;
  for (let s = 0; s < SAMPLES_PER_PACKET; s++) {
    const status = STATUS_OFF + s * FRAME_BYTES;
    pkt[status] = 0xc0;
    const data = PKT_IDX_DATA + s * FRAME_BYTES;
    pkt[data] = s + 1;
  }
  finishPacket(pkt);
  return pkt;
}

const parsed = parsePacket(makePacket(), 3, 1, MONTAGE, STREAM_CHANNELS);

assert.equal(SAMPLES_PER_PACKET, 8);
assert.equal(FRAME_BYTES, 15);
assert.equal(makePacket().length, 130);
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
badChecksum[checksumIndex(badChecksum)] ^= 0xff;
assert.deepEqual(parsePacket(badChecksum, 0, 1, MONTAGE, STREAM_CHANNELS), {
  ok: false,
  reason: 'checksum',
});

function makeMultiChannelPacket(): Uint8Array {
  const pkt = makePacket(1, 0);
  for (let s = 0; s < SAMPLES_PER_PACKET; s++) {
    const data = PKT_IDX_DATA + s * FRAME_BYTES;
    for (let ch = 0; ch < STREAM_CHANNELS; ch++) {
      const code = (ch + 1) * 0x000100;
      const co = data + ch * 3;
      pkt[co] = (code >>> 16) & 0xff;
      pkt[co + 1] = (code >>> 8) & 0xff;
      pkt[co + 2] = code & 0xff;
    }
  }
  finishPacket(pkt);
  return pkt;
}

const multi = makeMultiChannelPacket();
const asMontage = parsePacket(multi, 0, 1, MONTAGE, STREAM_CHANNELS);
assert.equal(asMontage.ok, true);
if (!asMontage.ok) throw new Error('unreachable');
assert.equal(asMontage.packet.samples[0].fp1_uV, 256);
assert.equal(asMontage.packet.samples[0].channels['Fp2'], 512);
assert.equal(asMontage.packet.samples[0].channels['EOG-L'], 768);
assert.equal(asMontage.packet.samples[0].channels['EOG-R'], 1024);

console.log('ALL BLE PACKET ASSERTIONS PASSED');
