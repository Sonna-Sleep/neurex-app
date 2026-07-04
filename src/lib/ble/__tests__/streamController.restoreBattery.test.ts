jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  removeItem: jest.fn(),
  setItem: jest.fn(),
}));

jest.mock('../../repos', () => ({
  deviceRepo: {
    pair: jest.fn(),
  },
}));

jest.mock('../../auth/supabase', () => ({
  getSupabase: jest.fn(() => null),
}));

jest.mock('../../accountDeletion', () => ({
  localWipe: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../push/registerPushToken', () => ({
  clearPushTokenRegistration: jest.fn().mockResolvedValue(undefined),
}));

const connectMock = jest.fn();
jest.mock('../index', () => ({
  bleClient: {
    connect: connectMock,
  },
}));

const onDeviceDisconnectedMock = jest.fn();
jest.mock('../manager', () => ({
  getBleManager: () => ({
    onDeviceDisconnected: onDeviceDisconnectedMock,
    cancelDeviceConnection: jest.fn().mockResolvedValue(undefined),
  }),
}));

jest.mock('../foregroundService', () => ({
  ensureBatteryOptimizationExemption: jest.fn(),
  startForegroundService: jest.fn(() => true),
  stopForegroundService: jest.fn(),
}));

jest.mock('../diskSpace', () => ({
  checkDiskSpace: jest.fn(() => ({ ok: true })),
  InsufficientStorageError: class InsufficientStorageError extends Error {},
}));

jest.mock('../recordingManifest', () => {
  const stats = {
    packets: 0,
    samples: 0,
    drops: 0,
    dupSkips: 0,
    lastSeq: null,
    generation: 0,
    lastBaseMs: null,
    timeGapCount: 0,
    totalTimeGapMs: 0,
    maxTimeGapMs: 0,
    deviceReboots: 0,
    rawRequired: true,
    rawOpened: false,
    rawBytesWritten: 0,
    rawClosed: false,
    rawUploaded: false,
    rawSha256: null,
    rawFailureReason: null,
    imuAvailable: false,
    imuOpened: false,
    imuNotifications: 0,
    imuBytesWritten: 0,
    imuClosed: false,
    imuUploaded: false,
    imuSha256: null,
    imuFailureReason: null,
  };
  return {
    endMsFromManifest: jest.fn(() => 1_000),
    ensureRecordingManifest: jest.fn(() => ({})),
    readRecordingManifest: jest.fn(() => null),
    statsFromManifest: jest.fn(() => ({ ...stats })),
  };
});

const setActiveRecordingMock = jest.fn().mockResolvedValue(undefined);
const stampRecordingDisconnectMock = jest.fn((meta, disconnectAtMs, lastBatteryPct) => ({
  ...meta,
  disconnectAtMs,
  lastBatteryPct,
}));
jest.mock('../../cloud/recovery', () => ({
  clearActiveRecording: jest.fn().mockResolvedValue(undefined),
  clearRecordingDisconnect: jest.fn((meta) => {
    const { disconnectAtMs: _disconnectAtMs, lastBatteryPct: _lastBatteryPct, ...clean } = meta;
    return clean;
  }),
  setActiveRecording: setActiveRecordingMock,
  stampRecordingDisconnect: stampRecordingDisconnectMock,
  writeSessionMeta: jest.fn(),
}));

jest.mock('../../cloud/cloudSync', () => ({
  transmitSession: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../cloud/streamStatsSidecar', () => ({
  writeStreamStatsSidecar: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../notifications/local', () => ({
  notifyDeviceDisconnected: jest.fn(),
  notifyRecordingStopped: jest.fn(),
}));

import { useSession } from '../../../state/session';
import {
  resumeSessionAfterRestore,
  stopSession,
} from '../streamController';

const baseScale = {
  sampleRateHz: 250,
  gain: 24,
  channelCount: 4,
  channels: [],
  variantKnown: 1,
};

function makeDevice() {
  const handle = {
    sessionDir: 'file://session',
    rawUri: 'file://session/RAW.BIN',
    imuUri: null,
    stop: jest.fn().mockResolvedValue({
      packets: 0,
      samples: 0,
      drops: 0,
      dupSkips: 0,
      lastSeq: null,
      generation: 0,
      lastBaseMs: null,
      timeGapCount: 0,
      totalTimeGapMs: 0,
      maxTimeGapMs: 0,
      deviceReboots: 0,
      rawRequired: true,
      rawOpened: false,
      rawBytesWritten: 0,
      rawClosed: false,
      rawUploaded: false,
      rawSha256: null,
      rawFailureReason: null,
      imuAvailable: false,
      imuOpened: false,
      imuNotifications: 0,
      imuBytesWritten: 0,
      imuClosed: false,
      imuUploaded: false,
      imuSha256: null,
      imuFailureReason: null,
    }),
  };
  return {
    deviceId: 'device-1',
    scale: baseScale,
    startStream: jest.fn().mockResolvedValue(handle),
    disconnect: jest.fn().mockResolvedValue(undefined),
  };
}

describe('resumeSessionAfterRestore battery tracking', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(10_000);
    (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;
    connectMock.mockReset();
    onDeviceDisconnectedMock.mockReset();
    setActiveRecordingMock.mockClear();
    stampRecordingDisconnectMock.mockClear();
    useSession.setState({ streaming: null, deviceBattery: null });
  });

  afterEach(async () => {
    await stopSession();
    jest.useRealTimers();
  });

  test('restored sessions stamp the last non-null battery reading on disconnect', async () => {
    const firstDevice = makeDevice();
    const secondDevice = makeDevice();
    connectMock
      .mockResolvedValueOnce(firstDevice)
      .mockResolvedValueOnce(secondDevice);
    let disconnectListener: (() => void) | null = null;
    onDeviceDisconnectedMock.mockImplementation((_deviceId, listener) => {
      disconnectListener = listener;
      return { remove: jest.fn() };
    });

    await resumeSessionAfterRestore({
      sessionId: 'session-1',
      startedAtMs: 1_000,
      deviceId: 'device-1',
      serial: 'serial-1',
    });

    useSession.getState().setDeviceBattery(42);
    useSession.getState().setDeviceBattery(null);
    expect(disconnectListener).not.toBeNull();
    (disconnectListener as unknown as () => void)();

    expect(stampRecordingDisconnectMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: 'session-1' }),
      10_000,
      42,
    );
  });
});
