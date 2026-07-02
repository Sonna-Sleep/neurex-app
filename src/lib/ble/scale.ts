// Device-reported EEG amplitude scale, read once at connect from the
// Scale/DeviceInfo characteristic (NEUREX_SCALE_INFO_UUID). The firmware
// serializes neurex_scale_info_t (firmware/.../neurex_scale.h) as a packed
// little-endian struct; this is the app-side mirror. Current recordings require
// schema v4: variant_known, channel_role[8], and streamChannelCount.
//
// Reading the device's ACTUAL µV-per-LSB (instead of hardcoding EEG_UV_PER_LSB)
// means a future PGA-gain change propagates by itself — a firmware-only flash
// can no longer silently 24× every recorded microvolt.
//
// LAYOUT CONTRACT: the struct is APPEND-ONLY. Newer firmware may add fields at
// the end and bump NEUREX_SCALE_SCHEMA_VER; the current fields below keep their
// offsets. A reordering/removal is a breaking change and MUST ship under a new
// characteristic UUID, never a bumped schema.

import {
  ADS1299_PHYSICAL_CHANNELS,
  NEUREX_SCALE_INFO_BYTES_V4,
  NEUREX_SCALE_INFO_SCHEMA_VER,
} from './constants';

export type DeviceScaleInfo = {
  /** Firmware schema version; recording requires v4+. */
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
   * Per-physical-channel montage map (offset 21, 8 bytes).
   * channelRole[c] is the role wire-value of physical channel c (0-based):
   *   0=UNUSED 1=Fp1 2=Fp2 3=EOG-L 4=EOG-R (must match firmware
   *   neurex_montage.h).
   * Required for recording; null means the firmware/app contract is invalid.
   */
  channelRole: number[] | null;
  /** EEG/EOG channels carried in each BLE frame / RAW.BIN record. */
  streamChannelCount: number;
};

/** Role wire-value -> human label. Mirrors firmware neurex_montage.h. */
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
  /** 0-based physical ADS1299 channel index (0..7). */
  index: number;
  /** 0-based EEG/EOG channel index within the BLE frame / RAW.BIN record. */
  streamIndex?: number;
  /** Role label, e.g. 'Fp1' | 'Fp2' | 'EOG-L' | 'EOG-R'. */
  role: string;
  /** Stable role wire value from firmware neurex_montage.h. */
  roleValue?: number;
};

/**
 * Resolve the active montage from a scale: every physical channel whose role is
 * a known electrode (1..4), in physical-channel order. Current firmware packs
 * active stream channels in that same order.
 */
export function activeChannels(scale: DeviceScaleInfo): ActiveChannel[] {
  const roles = scale.channelRole;
  if (roles && roles.length > 0) {
    const out: ActiveChannel[] = [];
    for (let i = 0; i < roles.length; i++) {
      const roleValue = roles[i];
      const label = ROLE_LABEL[roleValue];
      if (label !== undefined && i >= 0 && i < ADS1299_PHYSICAL_CHANNELS) {
        const streamIndex = out.length;
        if (streamIndex < scale.streamChannelCount) {
          out.push({ index: i, streamIndex, role: label, roleValue });
        }
      }
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
  channelRole: 21, // u8[8] (bytes 21..28)
  streamChannelCount: 29, // u8
} as const;

/** Bytes of the channel_role[] array (8 physical channels). */
const CHANNEL_ROLE_LEN = 8;

/**
 * Parse the Scale/DeviceInfo payload. Returns null when the bytes are absent,
 * short, older than v4, missing the stream count, or µV-per-LSB is not sane.
 * The BLE connection path treats null as a hard stop before recording.
 */
export function parseScaleInfo(
  bytes: Uint8Array | null | undefined,
): DeviceScaleInfo | null {
  if (!bytes || bytes.length < NEUREX_SCALE_INFO_BYTES_V4) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const schemaVer = dv.getUint16(OFF.schemaVer, true);
  if (schemaVer < NEUREX_SCALE_INFO_SCHEMA_VER) return null;
  const uvPerLsb = dv.getFloat32(OFF.uvPerLsb, true);
  if (!Number.isFinite(uvPerLsb) || uvPerLsb <= 0) return null;
  const variantKnown = dv.getUint8(OFF.variantKnown);
  const channelRole: number[] = [];
  for (let i = 0; i < CHANNEL_ROLE_LEN; i++) {
    channelRole.push(dv.getUint8(OFF.channelRole + i));
  }
  const streamChannelCount = dv.getUint8(OFF.streamChannelCount);
  if (
    !Number.isInteger(streamChannelCount) ||
    streamChannelCount < 1 ||
    streamChannelCount > ADS1299_PHYSICAL_CHANNELS
  ) {
    return null;
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
    streamChannelCount,
  };
}

/** Compact, self-describing scale block persisted with each recording (scale.json
 *  sidecar). camelCase to match the app's on-cloud JSON conventions. */
export function scaleProvenance(scale: DeviceScaleInfo) {
  const active = activeChannels(scale).sort(
    (a, b) => (a.streamIndex ?? a.index) - (b.streamIndex ?? b.index),
  );
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
    streamChannelCount: scale.streamChannelCount,
    streamChannelRole: active.map((c) => c.roleValue ?? 0),
    streamPhysicalIndex: active.map((c) => c.index),
  };
}
