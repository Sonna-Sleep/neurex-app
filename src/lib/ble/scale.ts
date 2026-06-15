// Device-reported EEG amplitude scale, read once at connect from the
// Scale/DeviceInfo characteristic (NEUREX_SCALE_INFO_UUID). The firmware
// serializes neurex_scale_info_t (firmware/.../neurex_scale.h) as a 20-byte
// little-endian struct; this is the app-side mirror.
//
// Reading the device's ACTUAL µV-per-LSB (instead of hardcoding EEG_UV_PER_LSB)
// means a future PGA-gain change propagates by itself — a firmware-only flash
// can no longer silently 24× every recorded microvolt.
//
// LAYOUT CONTRACT: the struct is APPEND-ONLY. Newer firmware may add fields at
// the end and bump NEUREX_SCALE_SCHEMA_VER; the v1 fields below keep their
// offsets, so an older app still reads them. A reordering/removal is a breaking
// change and MUST ship under a new characteristic UUID, never a bumped schema.

import {
  EEG_UV_PER_LSB,
  NEUREX_SCALE_INFO_BYTES,
} from './constants';

export type DeviceScaleInfo = {
  /** Firmware schema version; 0 = synthesized fallback (no device characteristic). */
  schemaVer: number;
  pgaGain: number;
  adcBits: number;
  vrefV: number;
  /** The number that matters: microvolts per ADS1299 LSB at the active gain. */
  uvPerLsb: number;
  sampleRateHz: number;
  nChannels: number;
  fp1Index: number;
  /** First 4 bytes of the firmware ELF SHA256 — build provenance. */
  fwBuildId: number;
};

/** Scale used when a unit predates the characteristic. Byte-identical to the old
 *  hardcoded behavior (ADS1299 gain 1, ±4.5 V → ~0.5364 µV/LSB). */
export const FALLBACK_SCALE: DeviceScaleInfo = {
  schemaVer: 0,
  pgaGain: 1,
  adcBits: 24,
  vrefV: 4.5,
  uvPerLsb: EEG_UV_PER_LSB,
  sampleRateHz: 250,
  nChannels: 1,
  fp1Index: 0,
  fwBuildId: 0,
};

// Byte offsets — must match neurex_scale_info_t exactly (little-endian, packed).
const OFF = {
  schemaVer: 0, // u16
  pgaGain: 2, // u8
  adcBits: 3, // u8
  vrefV: 4, // f32
  uvPerLsb: 8, // f32
  sampleRateHz: 12, // u16
  nChannels: 14, // u8
  fp1Index: 15, // u8
  fwBuildId: 16, // u32
} as const;

/**
 * Parse the Scale/DeviceInfo payload. Returns null — so the caller falls back to
 * FALLBACK_SCALE — when the bytes are absent/short, the schema is older than v1,
 * or µV-per-LSB is not a sane positive number. Never trust a garbage scale over
 * the known-good fallback.
 */
export function parseScaleInfo(
  bytes: Uint8Array | null | undefined,
): DeviceScaleInfo | null {
  if (!bytes || bytes.length < NEUREX_SCALE_INFO_BYTES) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const schemaVer = dv.getUint16(OFF.schemaVer, true);
  // Append-only contract → accept any v1+; we only read the stable v1 prefix.
  if (schemaVer < 1) return null;
  const uvPerLsb = dv.getFloat32(OFF.uvPerLsb, true);
  if (!Number.isFinite(uvPerLsb) || uvPerLsb <= 0) return null;
  return {
    schemaVer,
    pgaGain: dv.getUint8(OFF.pgaGain),
    adcBits: dv.getUint8(OFF.adcBits),
    vrefV: dv.getFloat32(OFF.vrefV, true),
    uvPerLsb,
    sampleRateHz: dv.getUint16(OFF.sampleRateHz, true),
    nChannels: dv.getUint8(OFF.nChannels),
    fp1Index: dv.getUint8(OFF.fp1Index),
    fwBuildId: dv.getUint32(OFF.fwBuildId, true),
  };
}

/** Compact, self-describing scale block persisted with each recording (meta.json
 *  sidecar). camelCase to match the app's on-cloud JSON conventions. */
export function scaleProvenance(scale: DeviceScaleInfo) {
  return {
    source: scale.schemaVer === 0 ? ('fallback' as const) : ('device' as const),
    schemaVer: scale.schemaVer,
    pgaGain: scale.pgaGain,
    adcBits: scale.adcBits,
    vrefV: scale.vrefV,
    uvPerLsb: scale.uvPerLsb,
    sampleRateHz: scale.sampleRateHz,
    nChannels: scale.nChannels,
    fp1Index: scale.fp1Index,
    fwBuildId: scale.fwBuildId,
  };
}
