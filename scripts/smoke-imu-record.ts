import assert from 'node:assert/strict';

import {
  encodeImuNotification,
  imuHeader,
  IMU_HEADER_BYTES,
  IMU_MAGIC,
  IMU_MAX_NOTIFY_BYTES,
  IMU_RECORD_HEADER_BYTES,
  IMU_SCHEMA_VER,
} from '../src/lib/ble/imuRecord';

function u64Parts(ms: number): { lo: number; hi: number } {
  const whole = Math.floor(ms);
  return {
    lo: whole >>> 0,
    hi: Math.floor(whole / 0x100000000) >>> 0,
  };
}

const header = imuHeader();
assert.equal(header.length, IMU_HEADER_BYTES);
assert.equal(String.fromCharCode(header[0], header[1], header[2], header[3]), IMU_MAGIC);
const hv = new DataView(header.buffer, header.byteOffset, header.byteLength);
assert.equal(hv.getUint16(4, true), IMU_SCHEMA_VER);
assert.equal(hv.getUint16(6, true), IMU_HEADER_BYTES);
assert.equal(hv.getUint16(8, true), IMU_RECORD_HEADER_BYTES);
assert.equal(hv.getUint16(10, true), IMU_MAX_NOTIFY_BYTES);
assert.equal(hv.getUint32(12, true), 0);

const payload = new Uint8Array([0x10, 0x20, 0x30, 0xff]);
const receivedAtMs = 5_000_000_123_456;
const record = encodeImuNotification(payload, receivedAtMs);
assert.equal(record.length, IMU_RECORD_HEADER_BYTES + payload.length);
const rv = new DataView(record.buffer, record.byteOffset, record.byteLength);
const parts = u64Parts(receivedAtMs);
assert.equal(rv.getUint32(0, true), parts.lo);
assert.equal(rv.getUint32(4, true), parts.hi);
assert.equal(rv.getUint16(8, true), payload.length);
assert.deepEqual(record.slice(IMU_RECORD_HEADER_BYTES), payload);

assert.throws(
  () => encodeImuNotification(new Uint8Array(IMU_MAX_NOTIFY_BYTES + 1), receivedAtMs),
  /too large/,
);

console.log('IMU record smoke passed');
