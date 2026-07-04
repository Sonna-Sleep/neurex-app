jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  removeItem: jest.fn(),
  setItem: jest.fn(),
}));

jest.mock('expo-file-system', () => ({
  Directory: class Directory {},
  File: class File {},
  Paths: { document: 'document://' },
}));

jest.mock('../cloudSync', () => ({
  transmitSession: jest.fn(),
}));

jest.mock('../../ble/recordingManifest', () => ({
  readRecordingManifest: jest.fn(),
}));

import {
  clearRecordingDisconnect,
  stampRecordingDisconnect,
  type RecordingMeta,
} from '../recovery';

const baseMeta: RecordingMeta = {
  sessionId: 'session-1',
  startedAtMs: 1_000,
  deviceId: 'device-1',
  serial: 'serial-1',
};

describe('recovery marker disconnect helpers', () => {
  test('stampRecordingDisconnect records disconnect time and last non-null battery', () => {
    const stamped = stampRecordingDisconnect(baseMeta, 5_000, 18);

    expect(stamped).toEqual({
      ...baseMeta,
      disconnectAtMs: 5_000,
      lastBatteryPct: 18,
    });
    expect(stamped).not.toBe(baseMeta);
  });

  test('clearRecordingDisconnect strips stale disconnect fields without mutating metadata', () => {
    const staleMarker: RecordingMeta = {
      ...baseMeta,
      disconnectAtMs: 5_000,
      lastBatteryPct: 18,
      endMs: 6_000,
    };

    const clean = clearRecordingDisconnect(staleMarker);

    expect(clean).toEqual({
      ...baseMeta,
      endMs: 6_000,
    });
    expect(clean).not.toHaveProperty('disconnectAtMs');
    expect(clean).not.toHaveProperty('lastBatteryPct');
    expect(staleMarker.disconnectAtMs).toBe(5_000);
    expect(staleMarker.lastBatteryPct).toBe(18);
  });
});
