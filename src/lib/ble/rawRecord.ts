// RAW.BIN v1 — the immutable EEG/EOG integer stream the app persists.
//
// RAW.BIN keeps the device-described biosignal stream so any night can be
// decoded later by a versioned backend decoder. The app does not write a
// derived single-channel FP1 file.
//
// The byte layout MUST match the backend reader (neurex-backend decoder.py,
// parse_raw_header / decode_raw). All little-endian:
//   Header (16 bytes): "NRX1" | schema_ver u16=1 | n_channels u8 |
//                      flags u8 (bit0 STATUS_PRESENT) | nominal_fs u16 |
//                      record_bytes u16 | reserved u32
//   Record (record_bytes each): ms u32 | seq u8 | status u8[3] |
//                               ch[0..n_channels-1] i32 (24-bit counts sign-extended)
//
// int32 (not packed int24) so the backend decodes it with a plain numpy struct
// dtype — int24 is exactly representable, so this is lossless. ms mirrors the
// app's sample clock reconstruction (baseMs + sampleIndex * 4 ms).

import {
  ACTIVE_STREAM_CHANNELS,
  ADS1299_PHYSICAL_CHANNELS,
  EEG_SAMPLE_INTERVAL_MS,
  EEG_SAMPLE_RATE_HZ,
  PKT_IDX_DATA,
  RAW_STATUS_BYTES,
  bytesPerFrame,
  samplesPerPacket,
} from './constants';

export const RAW_SCHEMA_VER = 1;
export const RAW_HEADER_BYTES = 16;
const RAW_FLAG_STATUS_PRESENT = 0x01;

export function rawRecordBytes(nChannels: number = ACTIVE_STREAM_CHANNELS): number {
  if (!Number.isInteger(nChannels) || nChannels < 1 || nChannels > ADS1299_PHYSICAL_CHANNELS) {
    throw new Error(`invalid RAW channel count ${nChannels}`);
  }
  return 4 + 1 + RAW_STATUS_BYTES + 4 * nChannels;
}

// Current v1 default: ms(4) + seq(1) + status(3) + 4 active channels * int32(4)
export const RAW_RECORD_BYTES = rawRecordBytes(ACTIVE_STREAM_CHANNELS);

// The 3 status bytes of a sample's frame sit immediately before its channel data.
const FRAME_STATUS_OFF = PKT_IDX_DATA - RAW_STATUS_BYTES;

/** The 16-byte RAW.BIN v1 file header (written once, at the start of the stream). */
export function rawHeader(
  nominalFs: number = EEG_SAMPLE_RATE_HZ,
  nChannels: number = ACTIVE_STREAM_CHANNELS,
): Uint8Array {
  const recordBytes = rawRecordBytes(nChannels);
  const h = new Uint8Array(RAW_HEADER_BYTES);
  const dv = new DataView(h.buffer);
  h[0] = 0x4e; // 'N'
  h[1] = 0x52; // 'R'
  h[2] = 0x58; // 'X'
  h[3] = 0x31; // '1'
  dv.setUint16(4, RAW_SCHEMA_VER, true);
  h[6] = nChannels;
  h[7] = RAW_FLAG_STATUS_PRESENT;
  dv.setUint16(8, nominalFs & 0xffff, true);
  dv.setUint16(10, recordBytes, true);
  dv.setUint32(12, 0, true); // reserved
  return h;
}

/**
 * Encode one parsed EEG/EOG packet's frames into RAW.BIN v1 records. `bytes`
 * is the original BLE packet; `baseMs`/`seq` come from the parse. Per sample s:
 * ms = baseMs + s*4 ms, packet seq, 3 status bytes, and stream int24 channel
 * counts sign-extended to int32.
 */
export function encodeRawPacket(
  bytes: Uint8Array,
  baseMs: number,
  seq: number,
  nChannels: number = ACTIVE_STREAM_CHANNELS,
): Uint8Array {
  const recordBytes = rawRecordBytes(nChannels);
  const frameBytes = bytesPerFrame(nChannels);
  const n = samplesPerPacket(bytes.length, nChannels);
  const out = new Uint8Array(n * recordBytes);
  const dv = new DataView(out.buffer);
  for (let s = 0; s < n; s++) {
    const r = s * recordBytes;
    const frame = FRAME_STATUS_OFF + s * frameBytes;
    dv.setUint32(r, (baseMs + s * EEG_SAMPLE_INTERVAL_MS) >>> 0, true); // ms
    out[r + 4] = seq & 0xff; // seq
    out[r + 5] = bytes[frame];
    out[r + 6] = bytes[frame + 1];
    out[r + 7] = bytes[frame + 2]; // status[0..2]
    for (let ch = 0; ch < nChannels; ch++) {
      const co = frame + RAW_STATUS_BYTES + ch * 3;
      const v = (bytes[co] << 16) | (bytes[co + 1] << 8) | bytes[co + 2];
      const signed = v & 0x800000 ? v - 0x1000000 : v;
      dv.setInt32(r + 8 + ch * 4, signed, true);
    }
  }
  return out;
}
