/** Live decoder for the firmware's BMA400 v1 notification.
 *
 * IMU.BIN remains an opaque byte-for-byte recording. This decoder is only a
 * side channel for smart-wake motion gating; malformed IMU data must never
 * interfere with EEG persistence.
 */

export const IMU_LIVE_SCHEMA_V1 = 1;
export const IMU_LIVE_PACKET_BYTES = 22;
export const BMA400_COUNTS_PER_G = 512;

export type LiveImuSample = {
  sequence: number;
  deviceTimestampMs: number;
  receivedAtMs: number;
  accelXG: number;
  accelYG: number;
  accelZG: number;
  temperatureRaw: number;
  gyroXRaw: number;
  gyroYRaw: number;
  gyroZRaw: number;
};

export function decodeLiveImu(
  bytes: Uint8Array,
  receivedAtMs: number = Date.now(),
): LiveImuSample | null {
  if (bytes.length !== IMU_LIVE_PACKET_BYTES) return null;
  if (bytes[0] !== IMU_LIVE_SCHEMA_V1 || bytes[1] !== 14) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    sequence: view.getUint16(2, true),
    deviceTimestampMs: view.getUint32(4, true),
    receivedAtMs,
    accelXG: view.getInt16(8, true) / BMA400_COUNTS_PER_G,
    accelYG: view.getInt16(10, true) / BMA400_COUNTS_PER_G,
    accelZG: view.getInt16(12, true) / BMA400_COUNTS_PER_G,
    temperatureRaw: view.getInt16(14, true),
    gyroXRaw: view.getInt16(16, true),
    gyroYRaw: view.getInt16(18, true),
    gyroZRaw: view.getInt16(20, true),
  };
}

export const MOTION_DYNAMIC_G = 0.08;
export const MOTION_SUSTAIN_MS = 500;
export const MOTION_HOLD_MS = 45_000;

/** Conservative movement detector. It removes the slowly changing gravity
 * vector, then requires dynamic acceleration for 500 ms before suppressing a
 * natural EEG trigger. It deliberately does not claim IMU-only mask removal.
 */
export class ImuMotionDetector {
  private gravity: [number, number, number] | null = null;
  private movingSinceMs: number | null = null;
  private activeUntilMs = 0;
  private lastSequence: number | null = null;
  private packetGaps = 0;

  feed(sample: LiveImuSample): void {
    if (this.lastSequence !== null) {
      const missing = (sample.sequence - this.lastSequence - 1) & 0xffff;
      if (missing > 0 && missing < 0x8000) this.packetGaps += missing;
    }
    this.lastSequence = sample.sequence;

    const a: [number, number, number] = [sample.accelXG, sample.accelYG, sample.accelZG];
    if (!this.gravity) this.gravity = [...a];
    // 20 Hz input; alpha=0.05 gives gravity/orientation a roughly 1 s time constant.
    const alpha = 0.05;
    this.gravity = [
      this.gravity[0] + alpha * (a[0] - this.gravity[0]),
      this.gravity[1] + alpha * (a[1] - this.gravity[1]),
      this.gravity[2] + alpha * (a[2] - this.gravity[2]),
    ];
    const dx = a[0] - this.gravity[0];
    const dy = a[1] - this.gravity[1];
    const dz = a[2] - this.gravity[2];
    const dynamicG = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dynamicG >= MOTION_DYNAMIC_G) {
      this.movingSinceMs ??= sample.receivedAtMs;
      if (sample.receivedAtMs - this.movingSinceMs >= MOTION_SUSTAIN_MS) {
        this.activeUntilMs = Math.max(this.activeUntilMs, sample.receivedAtMs + MOTION_HOLD_MS);
      }
    } else {
      this.movingSinceMs = null;
    }
  }

  isActive(nowMs: number = Date.now()): boolean {
    return nowMs < this.activeUntilMs;
  }

  getPacketGaps(): number {
    return this.packetGaps;
  }
}
