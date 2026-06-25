// raw.bin v1 — the immutable, all-channel integer GROUND TRUTH the app persists.
//
// Today eeg.bin is the app's already-decoded single-channel µV stream; once the
// phone selects FP1 and applies uvPerLsb, the other 7 channels and the original
// integer counts are gone forever. raw.bin keeps the device's full output so any
// night can be re-decoded later (e.g. after finding a scale/channel bug) by a
// versioned backend decoder. eeg.bin/eeg.edf become DERIVED artifacts.
//
// The byte layout MUST match the backend reader (neurex-backend decoder.py,
// parse_raw_header / decode_raw). All little-endian:
//   Header (16 bytes): "NRX1" | schema_ver u16=1 | n_channels u8=8 |
//                      flags u8 (bit0 STATUS_PRESENT) | nominal_fs u16 |
//                      record_bytes u16 | reserved u32
//   Record (record_bytes each): ms u32 | seq u8 | status u8[3] |
//                               ch[0..7] i32  (24-bit counts sign-extended)
//
// int32 (not packed int24) so the backend decodes it with a plain numpy struct
// dtype — int24 is exactly representable, so this is lossless. ms mirrors the
// app's eeg.bin reconstruction (baseMs + sampleIndex), so a backend re-decode of
// the FP1 channel reproduces eeg.bin byte-for-byte.

import {
  BYTES_PER_FRAME,
  EEG_SAMPLE_RATE_HZ,
  PKT_IDX_DATA,
  SAMPLES_PER_PACKET,
} from './constants';

export const RAW_SCHEMA_VER = 1;
export const RAW_N_CHANNELS = 8;
const RAW_STATUS_BYTES = 3;
export const RAW_HEADER_BYTES = 16;
const RAW_FLAG_STATUS_PRESENT = 0x01;
// ms(4) + seq(1) + status(3) + N channels * int32(4)
export const RAW_RECORD_BYTES = 4 + 1 + RAW_STATUS_BYTES + 4 * RAW_N_CHANNELS;

// The 3 status bytes of a sample's frame sit immediately before its channel data.
const FRAME_STATUS_OFF = PKT_IDX_DATA - RAW_STATUS_BYTES;

/** The 16-byte raw.bin v1 file header (written once, at the start of the stream). */
export function rawHeader(nominalFs: number = EEG_SAMPLE_RATE_HZ): Uint8Array {
  const h = new Uint8Array(RAW_HEADER_BYTES);
  const dv = new DataView(h.buffer);
  h[0] = 0x4e; // 'N'
  h[1] = 0x52; // 'R'
  h[2] = 0x58; // 'X'
  h[3] = 0x31; // '1'
  dv.setUint16(4, RAW_SCHEMA_VER, true);
  h[6] = RAW_N_CHANNELS;
  h[7] = RAW_FLAG_STATUS_PRESENT;
  dv.setUint16(8, nominalFs & 0xffff, true);
  dv.setUint16(10, RAW_RECORD_BYTES, true);
  dv.setUint32(12, 0, true); // reserved
  return h;
}

/**
 * Encode one parsed packet's SAMPLES_PER_PACKET frames into raw.bin v1 records
 * (all 8 channels, integer counts). `bytes` is the original 226-byte packet;
 * `baseMs`/`seq` come from the parse. Per sample s: ms = baseMs + s (matching
 * eeg.bin), the packet seq, the 3 status bytes, and the 8 int24 channel counts
 * sign-extended to int32.
 */
export function encodeRawPacket(bytes: Uint8Array, baseMs: number, seq: number): Uint8Array {
  const out = new Uint8Array(SAMPLES_PER_PACKET * RAW_RECORD_BYTES);
  const dv = new DataView(out.buffer);
  for (let s = 0; s < SAMPLES_PER_PACKET; s++) {
    const r = s * RAW_RECORD_BYTES;
    const frame = FRAME_STATUS_OFF + s * BYTES_PER_FRAME;
    dv.setUint32(r, (baseMs + s) >>> 0, true); // ms
    out[r + 4] = seq & 0xff; // seq
    out[r + 5] = bytes[frame];
    out[r + 6] = bytes[frame + 1];
    out[r + 7] = bytes[frame + 2]; // status[0..3]
    for (let ch = 0; ch < RAW_N_CHANNELS; ch++) {
      const co = frame + RAW_STATUS_BYTES + ch * 3;
      const v = (bytes[co] << 16) | (bytes[co + 1] << 8) | bytes[co + 2];
      const signed = v & 0x800000 ? v - 0x1000000 : v;
      dv.setInt32(r + 8 + ch * 4, signed, true);
    }
  }
  return out;
}
