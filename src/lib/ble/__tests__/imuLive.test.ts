import {
  BMA400_COUNTS_PER_G,
  decodeLiveImu,
  IMU_LIVE_PACKET_BYTES,
  ImuMotionDetector,
} from '../imuLive';

describe('live IMU side-channel', () => {
  test('decodes the exact 22-byte little-endian BMA400 v1 payload', () => {
    const bytes = new Uint8Array(IMU_LIVE_PACKET_BYTES);
    const view = new DataView(bytes.buffer);
    bytes[0] = 1;
    bytes[1] = 14;
    view.setUint16(2, 0x1234, true);
    view.setUint32(4, 0x01020304, true);
    view.setInt16(8, BMA400_COUNTS_PER_G, true);
    view.setInt16(10, -BMA400_COUNTS_PER_G / 2, true);
    view.setInt16(12, 0, true);
    view.setInt16(14, -7, true);

    expect(decodeLiveImu(bytes, 99)).toMatchObject({
      sequence: 0x1234,
      deviceTimestampMs: 0x01020304,
      receivedAtMs: 99,
      accelXG: 1,
      accelYG: -0.5,
      accelZG: 0,
      temperatureRaw: -7,
      gyroXRaw: 0,
      gyroYRaw: 0,
      gyroZRaw: 0,
    });
  });

  test('rejects malformed packets without throwing', () => {
    expect(decodeLiveImu(new Uint8Array(21))).toBeNull();
    const wrongSchema = new Uint8Array(22);
    wrongSchema[0] = 2;
    wrongSchema[1] = 14;
    expect(decodeLiveImu(wrongSchema)).toBeNull();
  });

  test('requires sustained dynamic acceleration before entering motion hold', () => {
    const detector = new ImuMotionDetector();
    const sample = (sequence: number, receivedAtMs: number, accelXG: number) => ({
      sequence,
      deviceTimestampMs: receivedAtMs,
      receivedAtMs,
      accelXG,
      accelYG: 0,
      accelZG: 1,
      temperatureRaw: 0,
      gyroXRaw: 0,
      gyroYRaw: 0,
      gyroZRaw: 0,
    });
    detector.feed(sample(0, 0, 0));
    detector.feed(sample(1, 100, 0.2));
    expect(detector.isActive(200)).toBe(false);
    detector.feed(sample(2, 650, 0.2));
    expect(detector.isActive(651)).toBe(true);
  });
});
