import assert from 'node:assert/strict';

import {
  BYTES_PER_FRAME,
  CH_FP1,
  EEG_UV_PER_LSB,
  NEUREX_SCALE_INFO_BYTES,
  PACKET_END_HI,
  PACKET_END_LO,
  PACKET_SIZE,
  PACKET_START_HI,
  PACKET_START_LO,
  PKT_IDX_CHECKSUM,
  PKT_IDX_DATA,
  PKT_IDX_SEQ,
  SAMPLES_PER_PACKET,
} from '../src/lib/ble/constants';
import { parsePacket } from '../src/lib/ble/packet';
import { FALLBACK_SCALE, parseScaleInfo, scaleProvenance } from '../src/lib/ble/scale';

// Build the neurex_scale_info_t the firmware serializes (little-endian).
// v1 = 20 bytes; pass `variantKnown` to emit the 21-byte schema-v2 payload
// (one appended byte at offset 20).
function makeScaleBytes(
  over: Partial<{
    schemaVer: number;
    pgaGain: number;
    adcBits: number;
    vrefV: number;
    uvPerLsb: number;
    sampleRateHz: number;
    nChannels: number;
    fp1Index: number;
    fwBuildId: number;
    variantKnown: number;
  }> = {},
): Uint8Array {
  const v2 = over.variantKnown !== undefined;
  const buf = new ArrayBuffer(NEUREX_SCALE_INFO_BYTES + (v2 ? 1 : 0));
  const dv = new DataView(buf);
  dv.setUint16(0, over.schemaVer ?? (v2 ? 2 : 1), true);
  dv.setUint8(2, over.pgaGain ?? 1);
  dv.setUint8(3, over.adcBits ?? 24);
  dv.setFloat32(4, over.vrefV ?? 4.5, true);
  dv.setFloat32(8, over.uvPerLsb ?? (4.5 / 2 ** 23) * 1e6, true);
  dv.setUint16(12, over.sampleRateHz ?? 250, true);
  dv.setUint8(14, over.nChannels ?? 1);
  dv.setUint8(15, over.fp1Index ?? 0);
  dv.setUint32(16, over.fwBuildId ?? 0xdeadbeef, true);
  if (v2) dv.setUint8(20, over.variantKnown as number);
  return new Uint8Array(buf);
}

// A valid 226-byte packet whose FP1 channel carries a known int24 code.
function makePacketWithFp1(code: number): Uint8Array {
  const pkt = new Uint8Array(PACKET_SIZE);
  pkt[0] = PACKET_START_HI;
  pkt[1] = PACKET_START_LO;
  pkt[PKT_IDX_SEQ] = 1;
  const u = code & 0xffffff;
  for (let s = 0; s < SAMPLES_PER_PACKET; s++) {
    const o = PKT_IDX_DATA + s * BYTES_PER_FRAME + CH_FP1 * 3;
    pkt[o] = (u >>> 16) & 0xff;
    pkt[o + 1] = (u >>> 8) & 0xff;
    pkt[o + 2] = u & 0xff;
  }
  let sum = 0;
  for (let i = PKT_IDX_SEQ; i < PKT_IDX_CHECKSUM; i++) sum = (sum + pkt[i]) & 0xff;
  pkt[PKT_IDX_CHECKSUM] = sum;
  pkt[PKT_IDX_CHECKSUM + 1] = PACKET_END_HI;
  pkt[PKT_IDX_CHECKSUM + 2] = PACKET_END_LO;
  return pkt;
}

// ── struct parse: a well-formed gain-1 payload round-trips ───────────────────
const g1 = parseScaleInfo(makeScaleBytes());
assert.ok(g1, 'gain-1 scale should parse');
assert.equal(g1!.schemaVer, 1);
assert.equal(g1!.pgaGain, 1);
assert.equal(g1!.adcBits, 24);
assert.equal(Math.round(g1!.vrefV * 10), 45);
assert.equal(g1!.sampleRateHz, 250);
assert.equal(g1!.fwBuildId, 0xdeadbeef);
// uv_per_lsb survives the float32 round-trip to within float epsilon.
assert.ok(Math.abs(g1!.uvPerLsb - EEG_UV_PER_LSB) < 1e-3, 'gain-1 µV/LSB matches fallback');

// ── rejection cases fall back (return null) rather than trust junk ───────────
assert.equal(parseScaleInfo(null), null, 'null → fallback');
assert.equal(parseScaleInfo(new Uint8Array(10)), null, 'short buffer → fallback');
assert.equal(parseScaleInfo(makeScaleBytes({ schemaVer: 0 })), null, 'schema 0 → fallback');
assert.equal(parseScaleInfo(makeScaleBytes({ uvPerLsb: 0 })), null, 'non-positive µV/LSB → fallback');
assert.equal(
  parseScaleInfo(makeScaleBytes({ uvPerLsb: Number.NaN })),
  null,
  'NaN µV/LSB → fallback',
);

// ── append-only forward-compat: a higher schema still reads the v1 prefix ────
const future = parseScaleInfo(makeScaleBytes({ schemaVer: 2 }));
assert.ok(future, 'future schema should still parse the v1 prefix');
assert.equal(future!.schemaVer, 2);
// A v2 schemaVer on a 20-byte payload (no appended byte) → variantKnown null,
// never read past the buffer.
assert.equal(future!.variantKnown, null, 'v2 schema but short (20B) payload → variantKnown null');

// ── schema v2: variant_known (offset 20) parsed when present ─────────────────
// Known board (configured) → 1.
const knownBoard = parseScaleInfo(makeScaleBytes({ variantKnown: 1 }));
assert.ok(knownBoard, 'v2 known-board payload should parse');
assert.equal(knownBoard!.schemaVer, 2, 'variantKnown bytes default to schema v2');
assert.equal(knownBoard!.variantKnown, 1, 'configured board → variantKnown 1');
// Unknown board (YELLOW fallback defaults, can rail) → 0. This is the value the
// app blocks on before recording a railed night.
const unknownBoard = parseScaleInfo(makeScaleBytes({ variantKnown: 0 }));
assert.ok(unknownBoard, 'v2 unknown-board payload should parse');
assert.equal(unknownBoard!.variantKnown, 0, 'unconfigured board → variantKnown 0');
// v1 (20-byte) firmware has no such byte → null (back-compat: don't block).
const v1 = parseScaleInfo(makeScaleBytes());
assert.equal(v1!.variantKnown, null, 'v1 20-byte payload → variantKnown null');
// provenance carries variant_known into the scale.json sidecar (cloud flag).
assert.equal(scaleProvenance(unknownBoard!).variantKnown, 0, 'provenance includes variantKnown 0');
assert.equal(scaleProvenance(knownBoard!).variantKnown, 1, 'provenance includes variantKnown 1');
assert.equal(scaleProvenance(v1!).variantKnown, null, 'provenance variantKnown null on v1');

// ── fallback constant equals the legacy hardcoded scale ──────────────────────
assert.equal(FALLBACK_SCALE.uvPerLsb, EEG_UV_PER_LSB);
assert.equal(scaleProvenance(FALLBACK_SCALE).source, 'fallback');
assert.equal(scaleProvenance(g1!).source, 'device');

// ── the conversion HONORS the device scale: a gain-24 device reads 24× smaller
// µV for the same raw code than the gain-1 fallback would. This is the whole
// point — the app no longer assumes a fixed scale.
const CODE = 100_000;
const gain24 = parseScaleInfo(makeScaleBytes({ pgaGain: 24, uvPerLsb: (4.5 / 2 ** 23 / 24) * 1e6 }));
assert.ok(gain24, 'gain-24 scale should parse');

const pkt = makePacketWithFp1(CODE);
const atG1 = parsePacket(pkt, 0, g1!.uvPerLsb);
const atG24 = parsePacket(pkt, 0, gain24!.uvPerLsb);
const dflt = parsePacket(pkt, 0); // no scale → fallback (gain 1)
assert.ok(atG1.ok && atG24.ok && dflt.ok);
if (!atG1.ok || !atG24.ok || !dflt.ok) throw new Error('unreachable');

const uvG1 = atG1.packet.samples[0].fp1_uV;
const uvG24 = atG24.packet.samples[0].fp1_uV;
assert.ok(Math.abs(uvG1 - CODE * g1!.uvPerLsb) < 1e-6, 'gain-1 µV = code × uvPerLsb');
assert.ok(Math.abs(uvG24 - CODE * gain24!.uvPerLsb) < 1e-6, 'gain-24 µV = code × uvPerLsb');
assert.ok(Math.abs(uvG1 / uvG24 - 24) < 1e-3, 'gain-1 reads 24× the µV of gain-24 for one code');
// Default (no scale arg) must equal the gain-1 fallback exactly — back-compat.
assert.equal(dflt.packet.samples[0].fp1_uV, uvG1);

console.log('ALL BLE SCALE ASSERTIONS PASSED');
