// Device-reported EEG amplitude scale, read once at connect from the
// Scale/DeviceInfo characteristic (NEUREX_SCALE_INFO_UUID). The firmware
// serializes neurex_scale_info_t (firmware/.../neurex_scale.h) as a packed
// little-endian struct; this is the app-side mirror. Current production requires
// schema v3: 29 bytes with variant_known and channel_role[8].
//
// Reading the device's ACTUAL µV-per-LSB (instead of hardcoding EEG_UV_PER_LSB)
// means a future PGA-gain change propagates by itself — a firmware-only flash
// can no longer silently 24× every recorded microvolt.
//
// LAYOUT CONTRACT: the struct is APPEND-ONLY. Newer firmware may add fields at
// the end and bump NEUREX_SCALE_SCHEMA_VER; the v3 fields below keep their
// offsets. A reordering/removal is a breaking change and MUST ship under a new
// characteristic UUID, never a bumped schema.

import { NEUREX_SCALE_INFO_BYTES } from './constants';

export type DeviceScaleInfo = {
  /** Firmware schema version; recording requires v3+. */
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
  /**
   * 1 = the board's MAC matched a known config in firmware; 0 = the board used
   * fallback defaults and should not be treated as a clean production capture.
   */
  variantKnown: number;
  /**
   * Schema-v3 field (offset 21, 8 bytes): the per-physical-channel montage map.
   * channelRole[c] is the role wire-value of physical channel c (0-based):
   *   0=UNUSED 1=Fp1 2=Fp2 3=EOG-L 4=EOG-R (must match firmware
   *   neurex_montage.h). Mirrors scale_v3.py's channel_role[].
   * Required for recording; null means the firmware/app contract is invalid.
   */
  channelRole: number[] | null;
};

/** Role wire-value → human label. Mirrors scale_v3.py `_ROLE_LABEL`. */
export const ROLE_LABEL: Readonly<Record<number, string>> = {
  1: 'Fp1',
  2: 'Fp2',
  3: 'EOG-L',
  4: 'EOG-R',
};

/** The Fp1 role label used by live consumers via EegSample.fp1_uV. */
export const FP1_ROLE = 'Fp1';

/** One active montage channel: which physical ADS1299 channel carries which role. */
export type ActiveChannel = {
  /** 0-based physical channel index within a 27-byte frame (0..7). */
  index: number;
  /** Role label, e.g. 'Fp1' | 'Fp2' | 'EOG-L' | 'EOG-R'. */
  role: string;
};

/**
 * Resolve the active montage from a scale: `[{index, role}, …]`. Mirrors
 * scale_v3.py `active_channels`:
 * every physical channel whose role is a known electrode (1..4), in physical-
 * channel order. A missing/empty channelRole is invalid for current recordings.
 * Always guards the index to an in-frame channel (0..7).
 */
export function activeChannels(scale: DeviceScaleInfo): ActiveChannel[] {
  const roles = scale.channelRole;
  if (roles && roles.length > 0) {
    const out: ActiveChannel[] = [];
    for (let i = 0; i < roles.length; i++) {
      const label = ROLE_LABEL[roles[i]];
      if (label !== undefined && i >= 0 && i < 8) out.push({ index: i, role: label });
    }
    if (out.length > 0) return out;
  }
  return [];
}

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
  variantKnown: 20, // u8 — schema v2+ only (byte 20)
  channelRole: 21, // u8[8] — schema v3+ only (bytes 21..28)
} as const;

/** Bytes of the channel_role[] array appended in schema v3 (8 physical channels). */
const CHANNEL_ROLE_LEN = 8;

/**
 * Parse the Scale/DeviceInfo payload. Returns null when the bytes are absent,
 * short, older than v3, missing the montage tail, or µV-per-LSB is not sane.
 * The BLE connection path treats null as a hard stop before recording.
 */
export function parseScaleInfo(
  bytes: Uint8Array | null | undefined,
): DeviceScaleInfo | null {
  if (!bytes || bytes.length < NEUREX_SCALE_INFO_BYTES) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const schemaVer = dv.getUint16(OFF.schemaVer, true);
  if (schemaVer < 3) return null;
  const uvPerLsb = dv.getFloat32(OFF.uvPerLsb, true);
  if (!Number.isFinite(uvPerLsb) || uvPerLsb <= 0) return null;
  const variantKnown = dv.getUint8(OFF.variantKnown);
  const channelRole: number[] = [];
  for (let i = 0; i < CHANNEL_ROLE_LEN; i++) {
    channelRole.push(dv.getUint8(OFF.channelRole + i));
  }
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
    variantKnown,
    channelRole,
  };
}

/** Compact, self-describing scale block persisted with each recording (scale.json
 *  sidecar). camelCase to match the app's on-cloud JSON conventions. */
export function scaleProvenance(scale: DeviceScaleInfo) {
  return {
    source: 'device' as const,
    schemaVer: scale.schemaVer,
    pgaGain: scale.pgaGain,
    adcBits: scale.adcBits,
    vrefV: scale.vrefV,
    uvPerLsb: scale.uvPerLsb,
    sampleRateHz: scale.sampleRateHz,
    nChannels: scale.nChannels,
    fp1Index: scale.fp1Index,
    fwBuildId: scale.fwBuildId,
    // Lands in the scale.json sidecar so the cloud can flag a railed night
    // recorded by an unconfigured board.
    variantKnown: scale.variantKnown,
    // The per-channel montage map (CH→role). Lets the cloud reconstruct which
    // physical channel carried Fp1/Fp2/EOG-L/EOG-R.
    channelRole: scale.channelRole,
  };
}
