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
 *   - A legacy single-channel device (no channel_role) yields channels={'Fp1':…}
 *     and the exact same fp1_uV as before montage support existed.
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
import { activeChannels, FALLBACK_SCALE } from '../scale';
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
    ...FALLBACK_SCALE,
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

  const out = parsePacket(pkt, 0, uvPerLsb, v3Scale.fp1Index, active);
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

// ── Test 2: RED-style montage (Fp1 on CH5) still maps roles to physical ch ───
// A board that carries Fp1 on physical CH5 (index 4). activeChannels must read
// the montage, and fp1_uV must follow the Fp1 role to CH5 — not hardcode CH1.
{
  const uvPerLsb = 1; // raw codes == µV for an obvious assertion
  const codes = { 0: 11, 4: 4242, 5: 7 }; // CH1=11, CH5=4242 (Fp1), CH6=7 (Fp2)
  const pkt = makePacket(codes);
  const redScale: DeviceScaleInfo = {
    ...FALLBACK_SCALE,
    schemaVer: 3,
    uvPerLsb,
    fp1Index: 4,
    channelRole: [0, 0, 0, 0, 1, 2, 0, 0], // CH5=Fp1, CH6=Fp2
  };
  const active = activeChannels(redScale);
  assert.deepEqual(active, [
    { index: 4, role: 'Fp1' },
    { index: 5, role: 'Fp2' },
  ]);
  const out = parsePacket(pkt, 0, uvPerLsb, redScale.fp1Index, active);
  assert.equal(out.ok, true);
  if (!out.ok) throw new Error('unreachable');
  const s0 = out.packet.samples[0];
  assert.equal(s0.channels['Fp1'], 4242);
  assert.equal(s0.channels['Fp2'], 7);
  assert.equal(s0.fp1_uV, 4242); // follows Fp1 to CH5, NOT CH1's 11
  console.log('PASS montage-red: Fp1 follows channel_role to physical CH5');
}

// ── Test 3: legacy single-channel (no channel_role) — back-compat ────────────
// No montage passed (and v1/v2 scale has channelRole=null). channels must be
// exactly { 'Fp1': fp1_uV } and fp1_uV byte-identical to the old single-channel
// decode at fp1Index.
{
  const uvPerLsb = 0.5364;
  const codes = { 0: 256, 4: 1280 }; // CH1=256, CH5=1280
  const pkt = makePacket(codes);

  // 3a) No active arg at all → defaults to fp1Index channel as 'Fp1'.
  const legacy = parsePacket(pkt, 0, uvPerLsb, 0);
  assert.equal(legacy.ok, true);
  if (!legacy.ok) throw new Error('unreachable');
  const l0 = legacy.packet.samples[0];
  assert.deepEqual(Object.keys(l0.channels), ['Fp1']);
  approx(l0.channels['Fp1'], 256 * uvPerLsb);
  approx(l0.fp1_uV, 256 * uvPerLsb);

  // 3b) v1/v2 scale → activeChannels falls back to the single fp1Index channel.
  const v1Scale: DeviceScaleInfo = {
    ...FALLBACK_SCALE,
    schemaVer: 1,
    uvPerLsb,
    fp1Index: 4, // RED on old firmware: Fp1 = CH5
    channelRole: null,
  };
  const active = activeChannels(v1Scale);
  assert.deepEqual(active, [{ index: 4, role: 'Fp1' }]);
  const out = parsePacket(pkt, 0, uvPerLsb, v1Scale.fp1Index, active);
  assert.equal(out.ok, true);
  if (!out.ok) throw new Error('unreachable');
  const o0 = out.packet.samples[0];
  assert.deepEqual(Object.keys(o0.channels), ['Fp1']);
  approx(o0.channels['Fp1'], 1280 * uvPerLsb); // CH5
  approx(o0.fp1_uV, 1280 * uvPerLsb);

  console.log('PASS legacy: single-channel → channels={Fp1}, fp1_uV unchanged');
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
    ...FALLBACK_SCALE,
    schemaVer: 3,
    uvPerLsb,
    nChannels: 4,
    fp1Index: 0,
    variantKnown: 1,
    channelRole: [1, 2, 3, 4, 0, 0, 0, 0],
  };
  const out = parsePacket(pkt, 0, uvPerLsb, 0, activeChannels(v3));
  assert.equal(out.ok, true, '18-sample packet must parse, not be rejected as size');
  if (!out.ok) throw new Error('unreachable');
  assert.equal(out.packet.samples.length, 18, '18-sample build → 18 samples');
  approx(out.packet.samples[0].channels['Fp1'], 100_000 * uvPerLsb);
  approx(out.packet.samples[17].channels['EOG-L'], -50_000 * uvPerLsb);

  // A length that isn't 10 + N×27 is still rejected as 'size'.
  const bad = new Uint8Array(100);
  bad[0] = PACKET_START_HI;
  bad[1] = PACKET_START_LO;
  const badOut = parsePacket(bad, 0);
  assert.equal(badOut.ok, false);
  if (badOut.ok) throw new Error('unreachable');
  assert.equal(badOut.reason, 'size');

  console.log('PASS 18-sample: 496 B decodes 18 samples; mis-framed length → size');
}

console.log('ALL MONTAGE DECODE ASSERTIONS PASSED');
