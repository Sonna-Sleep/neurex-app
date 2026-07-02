/**
 * Full 4-channel compact montage decode tests for parsePacket.
 *
 * Run with:
 *   npx ts-node --transpile-only --project scripts/tsconfig.scripts.json \
 *     src/lib/ble/__tests__/packet.montage.test.ts
 */
import assert from 'node:assert/strict';

import {
  PACKET_END_HI,
  PACKET_END_LO,
  PACKET_START_HI,
  PACKET_START_LO,
  PKT_IDX_DATA,
  PKT_IDX_SEQ,
  PKT_TRAILER_BYTES,
  RAW_STATUS_BYTES,
  SAMPLES_PER_PACKET,
  bytesPerFrame,
} from '../constants';
import { parsePacket } from '../packet';
import { activeChannels } from '../scale';
import type { DeviceScaleInfo } from '../scale';

const STREAM_CHANNELS = 4;
const FRAME_BYTES = bytesPerFrame(STREAM_CHANNELS);
const STATUS_OFF = PKT_IDX_DATA - RAW_STATUS_BYTES;

function writeI24be(pkt: Uint8Array, offset: number, value: number): void {
  const v = value < 0 ? value + 0x1000000 : value;
  pkt[offset] = (v >>> 16) & 0xff;
  pkt[offset + 1] = (v >>> 8) & 0xff;
  pkt[offset + 2] = v & 0xff;
}

function finishPacket(pkt: Uint8Array): void {
  const checksumIdx = pkt.length - PKT_TRAILER_BYTES;
  let sum = 0;
  for (let i = PKT_IDX_SEQ; i < checksumIdx; i++) sum = (sum + pkt[i]) & 0xff;
  pkt[checksumIdx] = sum;
  pkt[checksumIdx + 1] = PACKET_END_HI;
  pkt[checksumIdx + 2] = PACKET_END_LO;
}

function makePacket(chCodes: Partial<Record<number, number>>, seq = 1): Uint8Array {
  const pkt = new Uint8Array(7 + SAMPLES_PER_PACKET * FRAME_BYTES + PKT_TRAILER_BYTES);
  pkt[0] = PACKET_START_HI;
  pkt[1] = PACKET_START_LO;
  pkt[PKT_IDX_SEQ] = seq;
  for (let s = 0; s < SAMPLES_PER_PACKET; s++) {
    const data = PKT_IDX_DATA + s * FRAME_BYTES;
    for (let ch = 0; ch < STREAM_CHANNELS; ch++) {
      writeI24be(pkt, data + ch * 3, chCodes[ch] ?? 0);
    }
  }
  finishPacket(pkt);
  return pkt;
}

const approx = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ~= ${b}`);

const baseScale: DeviceScaleInfo = {
  schemaVer: 4,
  pgaGain: 1,
  adcBits: 24,
  vrefV: 4.5,
  uvPerLsb: 0.5364,
  sampleRateHz: 250,
  nChannels: 4,
  fp1Index: 0,
  fwBuildId: 0x12345678,
  variantKnown: 1,
  channelRole: [1, 2, 3, 4, 0, 0, 0, 0],
  streamChannelCount: STREAM_CHANNELS,
};

{
  const codes = {
    0: 100_000,
    1: 200_000,
    2: -50_000,
    3: 75_000,
  };
  const pkt = makePacket(codes);
  const uvPerLsb = 0.5364;
  const scale: DeviceScaleInfo = { ...baseScale, uvPerLsb };

  const active = activeChannels(scale);
  assert.deepEqual(active, [
    { index: 0, streamIndex: 0, role: 'Fp1', roleValue: 1 },
    { index: 1, streamIndex: 1, role: 'Fp2', roleValue: 2 },
    { index: 2, streamIndex: 2, role: 'EOG-L', roleValue: 3 },
    { index: 3, streamIndex: 3, role: 'EOG-R', roleValue: 4 },
  ]);

  const out = parsePacket(pkt, 0, uvPerLsb, active, STREAM_CHANNELS);
  assert.equal(out.ok, true);
  if (!out.ok) throw new Error('unreachable');
  assert.equal(out.packet.samples.length, SAMPLES_PER_PACKET);

  for (const sample of out.packet.samples) {
    assert.deepEqual(Object.keys(sample.channels).sort(), [
      'EOG-L',
      'EOG-R',
      'Fp1',
      'Fp2',
    ]);
    approx(sample.channels.Fp1, 100_000 * uvPerLsb);
    approx(sample.channels.Fp2, 200_000 * uvPerLsb);
    approx(sample.channels['EOG-L'], -50_000 * uvPerLsb);
    approx(sample.channels['EOG-R'], 75_000 * uvPerLsb);
    approx(sample.fp1_uV, sample.channels.Fp1);
  }

  console.log('PASS montage-v4: Fp1/Fp2/EOG-L/EOG-R decode + fp1_uV retained');
}

{
  const makeSizedPacket = (samples: number): Uint8Array => {
    const pkt = new Uint8Array(7 + samples * FRAME_BYTES + PKT_TRAILER_BYTES);
    pkt[0] = PACKET_START_HI;
    pkt[1] = PACKET_START_LO;
    for (let s = 0; s < samples; s++) {
      const data = PKT_IDX_DATA + s * FRAME_BYTES;
      writeI24be(pkt, data, 100 + s);
    }
    finishPacket(pkt);
    return pkt;
  };

  const scale = { ...baseScale, uvPerLsb: 1 };
  const out = parsePacket(makeSizedPacket(3), 0, 1, activeChannels(scale), STREAM_CHANNELS);
  assert.equal(out.ok, true);
  if (!out.ok) throw new Error('unreachable');
  assert.equal(out.packet.samples.length, 3);
  assert.equal(out.packet.samples[2].fp1_uV, 102);

  const bad = makeSizedPacket(3);
  const checksumIdx = bad.length - PKT_TRAILER_BYTES;
  const shortened = bad.slice(0, checksumIdx - 1);
  assert.deepEqual(parsePacket(shortened, 0, 1, activeChannels(scale), STREAM_CHANNELS), {
    ok: false,
    reason: 'size',
  });

  console.log('PASS packet sizing: notification length derives sample count');
}
