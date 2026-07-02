import assert from 'node:assert/strict';

import {
  BYTES_PER_FRAME,
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
import { activeChannels, parseScaleInfo, scaleProvenance } from '../src/lib/ble/scale';

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
    channelRole: number[];
  }> = {},
): Uint8Array {
  const buf = new ArrayBuffer(NEUREX_SCALE_INFO_BYTES);
  const dv = new DataView(buf);
  dv.setUint16(0, over.schemaVer ?? 3, true);
  dv.setUint8(2, over.pgaGain ?? 1);
  dv.setUint8(3, over.adcBits ?? 24);
  dv.setFloat32(4, over.vrefV ?? 4.5, true);
  dv.setFloat32(8, over.uvPerLsb ?? EEG_UV_PER_LSB, true);
  dv.setUint16(12, over.sampleRateHz ?? 250, true);
  dv.setUint8(14, over.nChannels ?? 4);
  dv.setUint8(15, over.fp1Index ?? 0);
  dv.setUint32(16, over.fwBuildId ?? 0xdeadbeef, true);
  dv.setUint8(20, over.variantKnown ?? 1);
  const roles = over.channelRole ?? [1, 2, 3, 4, 0, 0, 0, 0];
  for (let i = 0; i < 8; i++) dv.setUint8(21 + i, roles[i] ?? 0);
  return new Uint8Array(buf);
}

function makePacketWithFp1(code: number): Uint8Array {
  const pkt = new Uint8Array(PACKET_SIZE);
  pkt[0] = PACKET_START_HI;
  pkt[1] = PACKET_START_LO;
  pkt[PKT_IDX_SEQ] = 1;
  const u = code & 0xffffff;
  for (let s = 0; s < SAMPLES_PER_PACKET; s++) {
    const o = PKT_IDX_DATA + s * BYTES_PER_FRAME;
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

const g1 = parseScaleInfo(makeScaleBytes());
assert.ok(g1, 'schema-v3 scale should parse');
assert.equal(g1!.schemaVer, 3);
assert.equal(g1!.pgaGain, 1);
assert.equal(g1!.adcBits, 24);
assert.equal(Math.round(g1!.vrefV * 10), 45);
assert.equal(g1!.sampleRateHz, 250);
assert.equal(g1!.nChannels, 4);
assert.equal(g1!.fp1Index, 0);
assert.equal(g1!.variantKnown, 1);
assert.equal(g1!.fwBuildId, 0xdeadbeef);
assert.deepEqual(g1!.channelRole, [1, 2, 3, 4, 0, 0, 0, 0]);
assert.ok(Math.abs(g1!.uvPerLsb - EEG_UV_PER_LSB) < 1e-3, 'gain-1 uV/LSB matches firmware formula');

assert.deepEqual(activeChannels(g1!), [
  { index: 0, role: 'Fp1' },
  { index: 1, role: 'Fp2' },
  { index: 2, role: 'EOG-L' },
  { index: 3, role: 'EOG-R' },
]);

assert.equal(parseScaleInfo(null), null, 'null scale rejected');
assert.equal(parseScaleInfo(new Uint8Array(20)), null, 'v1-sized scale rejected');
assert.equal(parseScaleInfo(makeScaleBytes({ schemaVer: 2 })), null, 'pre-v3 scale rejected');
assert.equal(parseScaleInfo(makeScaleBytes({ schemaVer: 0 })), null, 'schema 0 rejected');
assert.equal(parseScaleInfo(makeScaleBytes({ uvPerLsb: 0 })), null, 'non-positive uV/LSB rejected');
assert.equal(parseScaleInfo(makeScaleBytes({ uvPerLsb: Number.NaN })), null, 'NaN uV/LSB rejected');

const unknownBoard = parseScaleInfo(makeScaleBytes({ variantKnown: 0 }));
assert.ok(unknownBoard, 'v3 unknown-board payload should parse');
assert.equal(unknownBoard!.variantKnown, 0, 'unconfigured board -> variantKnown 0');
assert.equal(scaleProvenance(unknownBoard!).variantKnown, 0, 'provenance includes variantKnown 0');
assert.equal(scaleProvenance(g1!).source, 'device');

const CODE = 100_000;
const gain24 = parseScaleInfo(makeScaleBytes({ pgaGain: 24, uvPerLsb: (4.5 / 2 ** 23 / 24) * 1e6 }));
assert.ok(gain24, 'gain-24 scale should parse');

const pkt = makePacketWithFp1(CODE);
const atG1 = parsePacket(pkt, 0, g1!.uvPerLsb, activeChannels(g1!));
const atG24 = parsePacket(pkt, 0, gain24!.uvPerLsb, activeChannels(gain24!));
assert.ok(atG1.ok && atG24.ok);
if (!atG1.ok || !atG24.ok) throw new Error('unreachable');

const uvG1 = atG1.packet.samples[0].fp1_uV;
const uvG24 = atG24.packet.samples[0].fp1_uV;
assert.ok(Math.abs(uvG1 - CODE * g1!.uvPerLsb) < 1e-6, 'gain-1 uV = code x uvPerLsb');
assert.ok(Math.abs(uvG24 - CODE * gain24!.uvPerLsb) < 1e-6, 'gain-24 uV = code x uvPerLsb');
assert.ok(Math.abs(uvG1 / uvG24 - 24) < 1e-3, 'gain-1 reads 24x the uV of gain-24 for one code');

console.log('ALL BLE SCALE ASSERTIONS PASSED');
