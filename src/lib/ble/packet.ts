import {
  BYTES_PER_FRAME,
  DEVICE_REBOOT_GAP_MS,
  EEG_SAMPLE_INTERVAL_MS,
  PACKET_END_HI,
  PACKET_END_LO,
  PACKET_START_HI,
  PACKET_START_LO,
  PKT_IDX_DATA,
  PKT_IDX_SEQ,
  PKT_IDX_TS,
  PKT_TRAILER_BYTES,
  samplesPerPacket,
} from './constants';
import type { ActiveChannel } from './scale';
import { FP1_ROLE } from './scale';
import type { EegSample, ParsedPacket } from './types';

// Re-export so the resume decision + its threshold live behind one import.
export { DEVICE_REBOOT_GAP_MS };

// How to treat an incoming packet relative to the highest baseMs already
// written. baseMs is firmware ms-since-boot:
//   'accept' — first packet, or strictly newer than the last write.
//   'dup'    — at/below the last write but within DEVICE_REBOOT_GAP_MS: a
//              replayed packet on reconnect; drop so files stay monotonic.
//   'reboot' — more than DEVICE_REBOOT_GAP_MS below: the firmware clock reset
//              (brownout/watchdog), so this is a NEW device epoch, not a dup.
// Assumes in-order delivery within an epoch (BLE notify on one connection is
// ordered). A reboot inside the first DEVICE_REBOOT_GAP_MS of an epoch
// (lastBaseMs < the gap) reads as 'dup' — a small, accepted dead zone.
export type ResumeDecision = 'accept' | 'dup' | 'reboot';

export function classifyResume(
  lastBaseMs: number | null,
  baseMs: number,
): ResumeDecision {
  if (lastBaseMs === null) return 'accept';
  if (baseMs > lastBaseMs) return 'accept';
  if (lastBaseMs - baseMs > DEVICE_REBOOT_GAP_MS) return 'reboot';
  return 'dup';
}

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

// uvPerLsb and active come from the device's schema-v3 Scale characteristic.
// active describes which physical channel carries which role. parsePacket decodes
// every active channel into sample.channels keyed by role
// ('Fp1'/'Fp2'/'EOG-L'/'EOG-R') and sets fp1_uV from the Fp1 role for live consumers.
export function parsePacket(
  bytes: Uint8Array,
  generation: number,
  uvPerLsb: number,
  active: ActiveChannel[],
): ParseOutcome {
  // Derive samples-per-packet from the notification length — an 8-sample (226 B)
  // OR 18-sample (496 B) firmware build both parse. Reject a length that isn't a
  // valid packet framing. The checksum byte sits just before the 2 end markers.
  const nSamples = samplesPerPacket(bytes.length);
  if (nSamples <= 0) return { ok: false, reason: 'size' };
  const checksumIdx = bytes.length - PKT_TRAILER_BYTES;
  if (
    bytes[0] !== PACKET_START_HI ||
    bytes[1] !== PACKET_START_LO ||
    bytes[checksumIdx + 1] !== PACKET_END_HI ||
    bytes[checksumIdx + 2] !== PACKET_END_LO
  ) {
    return { ok: false, reason: 'markers' };
  }
  let sum = 0;
  for (let i = PKT_IDX_SEQ; i < checksumIdx; i++) sum = (sum + bytes[i]) & 0xff;
  if (sum !== bytes[checksumIdx]) return { ok: false, reason: 'checksum' };

  const seq = bytes[PKT_IDX_SEQ];
  const baseMs = u32be(bytes, PKT_IDX_TS);

  const montage = active.filter((c) => c.index >= 0 && c.index < 8);

  const samples: EegSample[] = new Array(nSamples);
  for (let s = 0; s < nSamples; s++) {
    const o = PKT_IDX_DATA + s * BYTES_PER_FRAME;
    const ms = (baseMs + s * EEG_SAMPLE_INTERVAL_MS) >>> 0;
    const channels: Record<string, number> = {};
    for (const { index, role } of montage) {
      channels[role] = i24be(bytes, o + index * 3) * uvPerLsb;
    }
    // fp1_uV is a live-consumer convenience. The connection path has already
    // verified the current firmware exposes Fp1 in the schema-v3 montage.
    const fp1_uV = channels[FP1_ROLE] ?? 0;
    samples[s] = { ms, fp1_uV, channels };
  }
  return { ok: true, packet: { generation, seq, baseMs, samples } };
}
