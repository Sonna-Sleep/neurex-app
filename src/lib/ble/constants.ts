// BLE service + characteristic UUIDs for the Neurex single-board tracker.
//
// Source of truth: firmware/cerelog/firmware/main/ble_stream.c on
// feat/single-board-ble-tracker in the Neurex algoritmai repo. The firmware
// names two custom 128-bit UUIDs:
//   - Service:    6e6b0000-1000-8000-0078-65726e6b0001
//   - EEG notify: 6e6b0000-1000-8000-0078-65726e6b0002
// (Derived from NimBLE's little-endian BLE_UUID128_INIT byte order.)
//
// Each device advertises a per-color local name ("Neurex Yellow",
// "Neurex Blue", "Neurex Green", "Neurex White", or "Neurex LT"). The scanner
// matches the shared "Neurex" prefix client-side (see ble/real.ts).
//
// Treat NEUREX_BLE_RESTORE_IDENTIFIER as immutable across app versions.
// iOS keys all preserved state to it; if it ever changes, every paired
// user's restored connections silently vanish.

export const NEUREX_SERVICE_UUID = '6e6b0000-1000-8000-0078-65726e6b0001';
export const NEUREX_EEG_NOTIFY_UUID = '6e6b0000-1000-8000-0078-65726e6b0002';

// Shared advertised-name prefix. The scanner matches this prefix client-side
// (see ble/real.ts) and uses the full name ("Neurex Yellow", …) as the
// human-readable label in the "found device" display.
export const NEUREX_DEVICE_LOCAL_NAME = 'Neurex';

// ACK characteristic (write-no-response, 2 bytes {gen, seq}). The
// phone writes its last contiguous frontier here so firmware-side accounting
// never advances past data the app actually received.
// Current firmware streaming remains best-effort; reconnect/resume is handled
// in the app with baseMs dedup and explicit drop counters.
// Same 6e6b... family as the service/notify UUIDs; firmware UUID is 6e6b0003.
export const NEUREX_ACK_WRITE_UUID = '6e6b0000-1000-8000-0078-65726e6b0003';

// Scale/DeviceInfo characteristic (READ-only, same 6e6b… family; firmware UUID
// 6e6b0004). The device serializes its ACTUAL amplitude scale here — µV-per-LSB,
// PGA gain, VREF, sample rate, channel map, firmware build id — as an append-only
// little-endian struct. Current firmware requires schema v4: channel_role[8]
// plus streamChannelCount, so BLE packets and RAW.BIN carry only active EEG/EOG
// channels.
// The app reads it once at connect so the scale and montage are self-describing
// instead of assumptions that silently break when the firmware changes.
export const NEUREX_SCALE_INFO_UUID = '6e6b0000-1000-8000-0078-65726e6b0004';
// Minimum accepted schema. v4 is the compact active-channel stream contract.
export const NEUREX_SCALE_INFO_SCHEMA_VER = 4;
export const NEUREX_SCALE_INFO_BYTES_V3 = 29;
export const NEUREX_SCALE_INFO_BYTES_V4 = 30;

// Optional IMU notify characteristic. Firmware may omit this; the app records
// it when present as a separate IMU.BIN stream so RAW.BIN stays EEG/EOG only.
export const NEUREX_IMU_NOTIFY_UUID = '6e6b0000-1000-8000-0078-65726e6b0005';

// How often the ACK loop writes the contiguous frontier. Firmware just needs
// SOMETHING periodic to drain the ring, not a per-packet ACK.
export const NEUREX_ACK_INTERVAL_MS = 250;

// Standard Bluetooth SIG-assigned UUIDs for the Battery Service. The
// firmware exposes a single Battery Level characteristic (0-100, uint8)
// with READ + NOTIFY. ble-plx requires the 128-bit form for monitor.
export const BATTERY_SERVICE_UUID = '0000180f-0000-1000-8000-00805f9b34fb';
export const BATTERY_LEVEL_CHAR_UUID = '00002a19-0000-1000-8000-00805f9b34fb';

/**
 * iOS Core Bluetooth state-preservation identifier. Used as the
 * `restoreStateIdentifier` option when constructing BleManager.
 *
 * IMMUTABLE — iOS keys all restored state to this string. Changing it
 * means iOS forgets every previously-paired peripheral on every user's
 * device. Treat like a database primary key.
 */
export const NEUREX_BLE_RESTORE_IDENTIFIER = 'neurex-ble-bg' as const;

// ── EEG signal scale ────────────────────────────────────────────────────────
// ADS1299, gain 1, ±4.5 V reference: 4.5 / 2^23 / 1 * 1e6 ≈ 0.5364 µV/LSB.
export const EEG_UV_PER_LSB = (4.5 / Math.pow(2, 23) / 1) * 1e6;

// Nominal sample rate from the firmware ADS1299 driver (4 ms per sample).
export const EEG_SAMPLE_RATE_HZ = 250;
export const EEG_SAMPLE_INTERVAL_MS = 4;
// 2026-06-03: 8 samples/packet (was 4). Full 250 SPS, but HALF the notification
// rate (~31/s vs 62.5/s) — far less native→JS bridge load. Must match the
// firmware BLE build's -DSAMPLES_PER_PACKET=8 EXACTLY.
export const SAMPLES_PER_PACKET = 8;
export const EEG_PACKET_INTERVAL_MS = SAMPLES_PER_PACKET * EEG_SAMPLE_INTERVAL_MS;
export const TIME_GAP_REPORT_THRESHOLD_MS = 1000;

// ── Packet layout ───────────────────────────────────────────────────────────
//   [0]    0xAB           start hi
//   [1]    0xCD           start lo
//   [2]    seq            uint8, wraps every 256 (~8.2 s at 31 packets/s)
//   [3..6] timestamp_ms   uint32 big-endian, ms since boot of first sample
//   [7..]                 N compact frames:
//                           3 bytes status
//                           stream channels × 3 bytes int24 big-endian
//   next   checksum       sum(bytes[2..last payload]) & 0xFF
//   final  0xDC 0xBA      end marker
export const PACKET_START_HI = 0xab;
export const PACKET_START_LO = 0xcd;
export const PACKET_END_HI = 0xdc;
export const PACKET_END_LO = 0xba;
export const PKT_IDX_SEQ = 2;
export const PKT_IDX_TS = 3;
// First sample's channel data starts after start[2] + seq[1] + ts[4] + status[3] = byte 10.
export const PKT_IDX_DATA = 10;
export const RAW_STATUS_BYTES = 3;
export const ADS1299_PHYSICAL_CHANNELS = 8;
export const ACTIVE_STREAM_CHANNELS = 4;

// Samples-per-packet is DERIVED from the BLE notification length, never hardcoded:
// a packet is a 7-byte header (start[2] + seq[1] + ts[4]) + N frames +
// a 3-byte trailer (checksum[1] + end[2]). The frame width comes from the
// device Scale descriptor. Returns 0 when len is not valid packet framing.
export const PKT_HEADER_BYTES = 7;
export const PKT_TRAILER_BYTES = 3;
export function bytesPerFrame(streamChannelCount: number = ACTIVE_STREAM_CHANNELS): number {
  if (
    !Number.isInteger(streamChannelCount) ||
    streamChannelCount < 1 ||
    streamChannelCount > ADS1299_PHYSICAL_CHANNELS
  ) {
    return 0;
  }
  return RAW_STATUS_BYTES + streamChannelCount * 3;
}

export function samplesPerPacket(
  len: number,
  streamChannelCount: number = ACTIVE_STREAM_CHANNELS,
): number {
  const frameBytes = bytesPerFrame(streamChannelCount);
  if (frameBytes <= 0) return 0;
  const framesBytes = len - PKT_HEADER_BYTES - PKT_TRAILER_BYTES;
  if (framesBytes <= 0 || framesBytes % frameBytes !== 0) return 0;
  return framesBytes / frameBytes;
}

// A backward jump in baseMs (firmware ms-since-boot) larger than this means the
// device rebooted (brownout/watchdog) and its clock reset — a NEW epoch, not a
// replayed dup. Smaller backward jumps are reconnect replays we still dedup.
export const DEVICE_REBOOT_GAP_MS = 60_000;
