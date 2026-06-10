// BLE service + characteristic UUIDs for the Neurex single-board tracker.
//
// Source of truth: firmware/cerelog/firmware/main/ble_stream.c on
// feat/single-board-ble-tracker in the Neurex algoritmai repo. The firmware
// names two custom 128-bit UUIDs:
//   - Service:    6e6b0000-1000-8000-0078-65726e6b0001
//   - EEG notify: 6e6b0000-1000-8000-0078-65726e6b0002
// (Derived from NimBLE's little-endian BLE_UUID128_INIT byte order.)
//
// The device advertises with local name "Neurex-EEG".
//
// Treat NEUREX_BLE_RESTORE_IDENTIFIER as immutable across app versions.
// iOS keys all preserved state to it; if it ever changes, every paired
// user's restored connections silently vanish.

export const NEUREX_SERVICE_UUID = '6e6b0000-1000-8000-0078-65726e6b0001';
export const NEUREX_EEG_NOTIFY_UUID = '6e6b0000-1000-8000-0078-65726e6b0002';

// Advertised local name. We scan by service UUID (Apple-compliant) and use
// the name as a human-readable fallback for the "found device" display.
export const NEUREX_DEVICE_LOCAL_NAME = 'Neurex-EEG';

// ACK characteristic (write-no-response, 2 bytes {gen, seq}). The
// phone writes its last contiguous frontier here so firmware-side accounting
// never advances past data the app actually received.
// Current firmware streaming remains best-effort; reconnect/resume is handled
// in the app with baseMs dedup and explicit drop counters.
// Same 6e6b... family as the service/notify UUIDs; firmware UUID is 6e6b0003.
export const NEUREX_ACK_WRITE_UUID = '6e6b0000-1000-8000-0078-65726e6b0003';

// How often the ACK loop writes the contiguous frontier. Firmware just needs
// SOMETHING periodic to drain the ring, not a per-packet ACK. Matches
// ACK_INTERVAL_S in tools/capture/ble_stream_recv.py.
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
// ADS1299, gain 24, ±4.5 V reference. Matches firmware ADS1299_UV_PER_LSB and
// tools/capture/ble_stream_recv.py (UV_PER_LSB = 4.5 / 2^23 / 24 * 1e6).
export const EEG_UV_PER_LSB = (4.5 / Math.pow(2, 23) / 24) * 1e6;

// Nominal sample rate from the firmware ADS1299 driver (4 ms per sample).
export const EEG_SAMPLE_RATE_HZ = 250;
export const EEG_SAMPLE_INTERVAL_MS = 4;
// 2026-06-03: 8 samples/packet (was 4). Full 250 SPS, but HALF the notification
// rate (~31/s vs 62.5/s) — far less native→JS bridge load. Must match the
// firmware BLE build's -DSAMPLES_PER_PACKET=8 EXACTLY (it derives
// PACKET_TOTAL_SIZE the same way).
export const SAMPLES_PER_PACKET = 8;

// ── Packet layout (226 bytes per notification) ──────────────────────────────
//   [0]    0xAB           start hi
//   [1]    0xCD           start lo
//   [2]    seq            uint8, wraps every 256 (~8.2 s at 31 packets/s)
//   [3..6] timestamp_ms   uint32 big-endian, ms since boot of first sample
//   [7..222]              8 × 27-byte frames:
//                           3 bytes status
//                           8 channels × 3 bytes int24 big-endian
//   [223]  checksum       sum(bytes[2..222]) & 0xFF
//   [224]  0xDC           end hi
//   [225]  0xBA           end lo
//   size = 10 (header+checksum+end) + 8 × 27 = 226.
export const PACKET_SIZE = 226;
export const PACKET_START_HI = 0xab;
export const PACKET_START_LO = 0xcd;
export const PACKET_END_HI = 0xdc;
export const PACKET_END_LO = 0xba;
export const PKT_IDX_SEQ = 2;
export const PKT_IDX_TS = 3;
// First sample's channel data starts after start[2] + seq[1] + ts[4] + status[3] = byte 10.
export const PKT_IDX_DATA = 10;
export const BYTES_PER_FRAME = 27;
export const PKT_IDX_CHECKSUM = 223; // 7 (header) + 8 × 27 (samples)

// Channel layout (sleep-mask wiring): export Fpz from CH1 for the current
// one-device EEG-only beta.
export const CH_FPZ = 0;
