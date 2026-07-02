// Session metadata assembler — the device/scale/app-version + tester-log columns
// the app stamps onto the sessions row at finalize (migration 0015). Pure so it's
// unit-testable (smoke-session-metadata.ts) without a device.

import appConfig from '../../../app.json';
import type { DeviceScaleInfo } from '../ble/scale';

const KNOWN_COLORS = ['YELLOW', 'BLUE', 'GREEN', 'WHITE', 'LT'] as const;

/** Map a BLE advertised name to a fleet color: "Neurex Yellow" -> "YELLOW".
 *  Unrecognized names (e.g. the "Neurex-Raw-XXXX" fallback) -> "UNKNOWN". */
export function colorFromSerial(serial?: string | null): string {
  if (!serial) return 'UNKNOWN';
  const m = serial.match(/Neurex[\s-]+([A-Za-z]+)/i);
  const word = m?.[1]?.toUpperCase();
  return word && (KNOWN_COLORS as readonly string[]).includes(word) ? word : 'UNKNOWN';
}

function deviceLabelFromColor(color: string): string | null {
  if (!color || color === 'UNKNOWN') return null;
  return color === 'LT' ? 'LT' : color.charAt(0) + color.slice(1).toLowerCase();
}

function cleanDisplayName(serial?: string | null): string | null {
  const s = serial?.trim();
  return s ? s : null;
}

/** Recording-conditions the tester logs (the firmware can't know these). */
export type TesterLog = {
  electrodeType?: string;
  electrodeBatch?: string;
  montage?: string;
  referenceSite?: string;
  biasSite?: string;
  tester?: string;
  notes?: string;
};

function blank(v?: string | null): boolean {
  return v == null || v.trim() === '';
}

// Tester-logged fields required before recording. This gate covers only fields
// the firmware cannot know; device-intrinsic metadata such as firmware_build_id
// and uv_per_lsb comes from the required Scale characteristic. notes + biasSite
// are optional.
export const REQUIRED_TESTER_FIELDS = [
  'electrodeType',
  'electrodeBatch',
  'montage',
  'referenceSite',
  'tester',
] as const;

/** True when every required tester-log field is filled (non-blank). Gate for
 *  allowing Start on a diagnostic capture. */
export function isTesterLogComplete(log: TesterLog | null | undefined): boolean {
  if (!log) return false;
  return REQUIRED_TESTER_FIELDS.every((f) => !blank(log[f]));
}

/** Assemble the sessions-row metadata columns. Scale fields are emitted only when a
 *  DeviceScaleInfo is present; blank tester-log fields are OMITTED so the backend's
 *  metadata-completeness gate correctly sees them as missing. */
export function buildSessionMetadata(opts: {
  deviceId?: string | null;
  serial?: string | null;
  scale?: DeviceScaleInfo | null;
  testerLog?: TesterLog | null;
  // The platform build number that produced this night. The RN caller passes the
  // Platform-aware value (Android versionCode / iOS buildNumber); defaults to the
  // Android versionCode from app.json so this stays node-pure for the smoke test.
  appBuild?: number | null;
}): Record<string, unknown> {
  const { deviceId, serial, scale, testerLog, appBuild } = opts;
  const deviceColor = colorFromSerial(serial);
  const out: Record<string, unknown> = {
    device_id: deviceId ?? null,
    device_color: deviceColor,
    device_label: deviceLabelFromColor(deviceColor),
    device_display_name: cleanDisplayName(serial),
    app_version: appConfig.expo.version,
    app_build: appBuild !== undefined ? appBuild : (appConfig.expo.android?.versionCode ?? null),
  };
  if (scale) {
    // fwBuildId is a uint32 device-ELF-sha256 prefix -> lowercase hex.
    out.firmware_build_id = (scale.fwBuildId >>> 0).toString(16);
    out.uv_per_lsb = scale.uvPerLsb;
    out.pga_gain = scale.pgaGain;
    out.vref_v = scale.vrefV;
    out.adc_bits = scale.adcBits;
    out.sample_rate_hz = scale.sampleRateHz;
    out.channel_count = scale.nChannels;
    out.fp1_index = scale.fp1Index;
    out.variant_known = scale.variantKnown === 1;
  }
  if (testerLog) {
    const map: [keyof TesterLog, string][] = [
      ['electrodeType', 'electrode_type'],
      ['electrodeBatch', 'electrode_batch'],
      ['montage', 'montage'],
      ['referenceSite', 'reference_site'],
      ['biasSite', 'bias_site'],
      ['tester', 'tester'],
      ['notes', 'notes'],
    ];
    for (const [k, col] of map) {
      const v = testerLog[k];
      if (!blank(v)) out[col] = v!.trim();
    }
  }
  return out;
}
