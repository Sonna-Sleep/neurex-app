// IMU.BIN v1 - exact BLE IMU notifications, preserved as received.
//
// The app intentionally does not parse accelerometer/gyro fields here. Firmware
// owns the IMU payload schema; the phone wraps each notification with receive
// time and payload length so the cloud can reconstruct exact BLE boundaries.

export const IMU_BIN_NAME = 'IMU.BIN';
export const IMU_META_NAME = 'imu.json';
export const IMU_MAGIC = 'NIM1';
export const IMU_SCHEMA_VER = 1;
export const IMU_HEADER_BYTES = 16;
export const IMU_RECORD_HEADER_BYTES = 10;
export const IMU_MAX_NOTIFY_BYTES = 509;

function writeU16LE(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
}

function writeU32LE(out: Uint8Array, offset: number, value: number): void {
  out[offset] = value & 0xff;
  out[offset + 1] = (value >>> 8) & 0xff;
  out[offset + 2] = (value >>> 16) & 0xff;
  out[offset + 3] = (value >>> 24) & 0xff;
}

function writeU64FromNumberLE(out: Uint8Array, offset: number, value: number): void {
  const whole = Math.max(0, Math.floor(value));
  writeU32LE(out, offset, whole >>> 0);
  writeU32LE(out, offset + 4, Math.floor(whole / 0x100000000) >>> 0);
}

export function imuHeader(): Uint8Array {
  const out = new Uint8Array(IMU_HEADER_BYTES);
  out[0] = IMU_MAGIC.charCodeAt(0);
  out[1] = IMU_MAGIC.charCodeAt(1);
  out[2] = IMU_MAGIC.charCodeAt(2);
  out[3] = IMU_MAGIC.charCodeAt(3);
  writeU16LE(out, 4, IMU_SCHEMA_VER);
  writeU16LE(out, 6, IMU_HEADER_BYTES);
  writeU16LE(out, 8, IMU_RECORD_HEADER_BYTES);
  writeU16LE(out, 10, IMU_MAX_NOTIFY_BYTES);
  writeU32LE(out, 12, 0);
  return out;
}

export function encodeImuNotification(
  payload: Uint8Array,
  receivedAtMs: number = Date.now(),
): Uint8Array {
  if (payload.length > IMU_MAX_NOTIFY_BYTES) {
    throw new Error(`IMU notification too large: ${payload.length} bytes`);
  }
  const out = new Uint8Array(IMU_RECORD_HEADER_BYTES + payload.length);
  writeU64FromNumberLE(out, 0, receivedAtMs);
  writeU16LE(out, 8, payload.length);
  out.set(payload, IMU_RECORD_HEADER_BYTES);
  return out;
}

