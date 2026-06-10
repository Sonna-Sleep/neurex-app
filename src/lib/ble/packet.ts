import {
  BYTES_PER_FRAME,
  CH_FPZ,
  EEG_UV_PER_LSB,
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
} from './constants';
import type { EegSample, ParsedPacket } from './types';

export type ParseOutcome =
  | { ok: true; packet: ParsedPacket }
  | { ok: false; reason: 'markers' | 'checksum' | 'size' };

function i24be(bytes: Uint8Array, offset: number): number {
  const v = (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
  return v & 0x800000 ? v - 0x1000000 : v;
}

function u32be(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000 +
    ((bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3])
  );
}

export function parsePacket(bytes: Uint8Array, generation: number): ParseOutcome {
  if (bytes.length !== PACKET_SIZE) return { ok: false, reason: 'size' };
  if (
    bytes[0] !== PACKET_START_HI ||
    bytes[1] !== PACKET_START_LO ||
    bytes[PKT_IDX_CHECKSUM + 1] !== PACKET_END_HI ||
    bytes[PKT_IDX_CHECKSUM + 2] !== PACKET_END_LO
  ) {
    return { ok: false, reason: 'markers' };
  }
  let sum = 0;
  for (let i = PKT_IDX_SEQ; i < PKT_IDX_CHECKSUM; i++) sum = (sum + bytes[i]) & 0xff;
  if (sum !== bytes[PKT_IDX_CHECKSUM]) return { ok: false, reason: 'checksum' };

  const seq = bytes[PKT_IDX_SEQ];
  const baseMs = u32be(bytes, PKT_IDX_TS);
  const samples: EegSample[] = new Array(SAMPLES_PER_PACKET);
  for (let s = 0; s < SAMPLES_PER_PACKET; s++) {
    const o = PKT_IDX_DATA + s * BYTES_PER_FRAME;
    const ms = (baseMs + s) >>> 0;
    samples[s] = {
      ms,
      fpz_uV: i24be(bytes, o + CH_FPZ * 3) * EEG_UV_PER_LSB,
    };
  }
  return { ok: true, packet: { generation, seq, baseMs, samples } };
}
