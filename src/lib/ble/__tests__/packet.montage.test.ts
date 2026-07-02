/**
 * Full 4-channel montage decode tests for parsePacket.
 *
 * This repo has no jest (see `src/lull/README.md`): pure-TS tests run via
 *   npx ts-node --transpile-only --project scripts/tsconfig.scripts.json \
 *     src/lib/ble/__tests__/packet.montage.test.ts
 * using `node:assert/strict`, the same pattern as the existing `smoke:*` scripts
 * and the Lull `*.test.ts` files.
 *
 * What this proves (Task 1 of the Lull Phase-2 plan):
 *   - With a v3 montage Scale (channel_role = [Fp1,Fp2,EOG-L,EOG-R,…]),
 *     parsePacket decodes ALL four role channels into sample.channels (×uvPerLsb)
 *     reading the correct physical channel for each role.
 *   - fp1_uV is retained verbatim (== channels['Fp1']) for existing consumers.
 */
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
  SAMPLES_PER_PACKET,
} from '../constants';
import { parsePacket } from '../packet';
import { activeChannels } from '../scale';
import type { DeviceScaleInfo } from '../scale';

// ── helpers ─────────────────────────────────────────────────────────────────

/** Write a signed int24 big-endian into pkt at the given offset. */
function writeI24be(pkt: Uint8Array, offset: number, value: number): void {
  const v = value < 0 ? value + 0x1000000 : value;
  pkt[offset] = (v >>> 16) & 0xff;
  pkt[offset + 1] = (v >>> 8) & 0xff;
  pkt[offset + 2] = v & 0xff;
}

/**
 * Build a valid 226 B packet. `chCodes[c]` is the int24 code written into every
 * sample of physical channel c (0..7). Channels left undefined are 0.
 */
function makePacket(chCodes: Partial<Record<number, number>>, seq = 1): Uint8Array {
  const pkt = new Uint8Array(PACKET_SIZE);
  pkt[0] = PACKET_START_HI;
  pkt[1] = PACKET_START_LO;
  pkt[PKT_IDX_SEQ] = seq;
  // baseMs stays 0 (bytes 3..6 = 0) — timing isn't under test here.
  for (let s = 0; s < SAMPLES_PER_PACKET; s++) {
    const o = PKT_IDX_DATA + s * BYTES_PER_FRAME;
    for (let ch = 0; ch < 8; ch++) {
      const code = chCodes[ch] ?? 0;
      writeI24be(pkt, o + ch * 3, code);
    }
  }
  let sum = 0;
  for (let i = PKT_IDX_SEQ; i < PKT_IDX_CHECKSUM; i++) sum = (sum + pkt[i]) & 0xff;
  pkt[PKT_IDX_CHECKSUM] = sum;
  pkt[PKT_IDX_CHECKSUM + 1] = PACKET_END_HI;
  pkt[PKT_IDX_CHECKSUM + 2] = PACKET_END_LO;
  return pkt;
}

const approx = (a: number, b: number, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

const baseScale: DeviceScaleInfo = {
  schemaVer: 3,
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
};

// ── Test 1: v3 montage — all four role channels decode ───────────────────────
// Distinct positive int24 codes per physical channel so a wrong channel index
// is obvious. CH1..CH4 carry the montage; CH5..CH8 are floating (ignored).
{
  const codes = {
    0: 100_000, // CH1 → Fp1
    1: 200_000, // CH2 → Fp2
    2: -50_000, // CH3 → EOG-L (signed: prove two's-complement decode)
    3: 75_000, // CH4 → EOG-R
    4: 999_999, // CH5 floating — must NOT appear in channels
  };
  const pkt = makePacket(codes);

  // v3 Scale: channel_role = [Fp1, Fp2, EOG-L, EOG-R, UNUSED×4].
  const uvPerLsb = 0.5364;
  const v3Scale: DeviceScaleInfo = {
    ...baseScale,
    schemaVer: 3,
    uvPerLsb,
    nChannels: 4,
    fp1Index: 0,
    variantKnown: 1,
    channelRole: [1, 2, 3, 4, 0, 0, 0, 0],
  };

  const active = activeChannels(v3Scale);
  assert.deepEqual(active, [
    { index: 0, role: 'Fp1' },
    { index: 1, role: 'Fp2' },
    { index: 2, role: 'EOG-L' },
    { index: 3, role: 'EOG-R' },
  ]);

  const out = parsePacket(pkt, 0, uvPerLsb, active);
  assert.equal(out.ok, true);
  if (!out.ok) throw new Error('unreachable');
  assert.equal(out.packet.samples.length, SAMPLES_PER_PACKET);

  for (const sample of out.packet.samples) {
    // Exactly the four montage roles, nothing else (CH5 floating is dropped).
    assert.deepEqual(Object.keys(sample.channels).sort(), [
      'EOG-L',
      'EOG-R',
      'Fp1',
      'Fp2',
    ]);
    approx(sample.channels['Fp1'], 100_000 * uvPerLsb);
    approx(sample.channels['Fp2'], 200_000 * uvPerLsb);
    approx(sample.channels['EOG-L'], -50_000 * uvPerLsb);
    approx(sample.channels['EOG-R'], 75_000 * uvPerLsb);
    // fp1_uV retained verbatim — equals the Fp1 channel.
    approx(sample.fp1_uV, 100_000 * uvPerLsb);
    approx(sample.fp1_uV, sample.channels['Fp1']);
  }

  console.log('PASS montage-v3: Fp1/Fp2/EOG-L/EOG-R decode + fp1_uV retained');
}

// ── 18-sample (496 B) firmware build parses via length-derivation ────────────
// The app used to hard-reject any length != 226 → an 18-sample build recorded
// NOTHING. Samples/packet is now derived from the notification length.
{
  const makeN = (
    chCodes: Partial<Record<number, number>>,
    n: number,
    seq = 1,
  ): Uint8Array => {
    const size = PKT_IDX_DATA + n * BYTES_PER_FRAME; // 10 + N×27
    const pkt = new Uint8Array(size);
    pkt[0] = PACKET_START_HI;
    pkt[1] = PACKET_START_LO;
    pkt[PKT_IDX_SEQ] = seq;
    for (let s = 0; s < n; s++) {
      const o = PKT_IDX_DATA + s * BYTES_PER_FRAME;
      for (let ch = 0; ch < 8; ch++) writeI24be(pkt, o + ch * 3, chCodes[ch] ?? 0);
    }
    const csum = size - 3;
    let sum = 0;
    for (let i = PKT_IDX_SEQ; i < csum; i++) sum = (sum + pkt[i]) & 0xff;
    pkt[csum] = sum;
    pkt[csum + 1] = PACKET_END_HI;
    pkt[csum + 2] = PACKET_END_LO;
    return pkt;
  };

  const uvPerLsb = 0.5364;
  const pkt = makeN({ 0: 100_000, 1: 200_000, 2: -50_000, 3: 75_000 }, 18);
  assert.equal(pkt.length, 496, '18-sample packet is 496 B');
  const v3: DeviceScaleInfo = {
    ...baseScale,
    schemaVer: 3,
    uvPerLsb,
    nChannels: 4,
    fp1Index: 0,
    variantKnown: 1,
    channelRole: [1, 2, 3, 4, 0, 0, 0, 0],
  };
  const out = parsePacket(pkt, 0, uvPerLsb, activeChannels(v3));
  assert.equal(out.ok, true, '18-sample packet must parse, not be rejected as size');
  if (!out.ok) throw new Error('unreachable');
  assert.equal(out.packet.samples.length, 18, '18-sample build → 18 samples');
  approx(out.packet.samples[0].channels['Fp1'], 100_000 * uvPerLsb);
  approx(out.packet.samples[17].channels['EOG-L'], -50_000 * uvPerLsb);

  // A length that isn't 10 + N×27 is still rejected as 'size'.
  const bad = new Uint8Array(100);
  bad[0] = PACKET_START_HI;
  bad[1] = PACKET_START_LO;
  const badOut = parsePacket(bad, 0, uvPerLsb, activeChannels(v3));
  assert.equal(badOut.ok, false);
  if (badOut.ok) throw new Error('unreachable');
  assert.equal(badOut.reason, 'size');

  console.log('PASS 18-sample: 496 B decodes 18 samples; mis-framed length → size');
}

console.log('ALL MONTAGE DECODE ASSERTIONS PASSED');
