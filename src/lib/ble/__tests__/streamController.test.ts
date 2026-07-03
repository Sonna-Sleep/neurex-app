import { encodeCancel } from '../smartAlarm';

const mockBleClient = {
  connect: jest.fn(),
};

const mockBleManager = {
  onDeviceDisconnected: jest.fn(),
  cancelDeviceConnection: jest.fn().mockResolvedValue(undefined),
};

const mockSessionState = {
  wakeAlarm: null as { hour: number; minute: number; enabled: boolean } | null,
  streaming: null as
    | {
        sessionId: string;
        startedAtMs: number;
        packets: number;
        samples: number;
        drops: number;
        lastSeq: number | null;
        generation: number;
        connection: 'connected' | 'reconnecting' | 'lost';
        error?: string | null;
      }
    | null,
  deviceBattery: null as number | null,
  setStreaming: jest.fn((streaming) => {
    mockSessionState.streaming = streaming;
  }),
  patchStreaming: jest.fn((patch) => {
    if (!mockSessionState.streaming) return;
    mockSessionState.streaming = { ...mockSessionState.streaming, ...patch };
  }),
};

const mockUseSession = {
  getState: () => mockSessionState,
  subscribe: jest.fn(() => jest.fn()),
};

const mockStartForegroundService = jest.fn(() => true);
const mockStopForegroundService = jest.fn();
const mockEnsureBatteryOptimizationExemption = jest.fn();
const mockSetActiveRecording = jest.fn().mockResolvedValue(undefined);
const mockClearActiveRecording = jest.fn().mockResolvedValue(undefined);
const mockWriteSessionMeta = jest.fn();
const mockNotifyDeviceDisconnected = jest.fn();
const mockNotifyRecordingStopped = jest.fn();
const mockWriteStreamStatsSidecar = jest.fn().mockResolvedValue(undefined);
const mockTransmitSession = jest.fn().mockResolvedValue(undefined);
const mockCheckDiskSpace = jest.fn(() => ({ ok: true }));

jest.mock('../index', () => ({
  bleClient: mockBleClient,
}));

jest.mock('../manager', () => ({
  getBleManager: jest.fn(() => mockBleManager),
}));

jest.mock('../../../state/session', () => ({
  useSession: mockUseSession,
}));

jest.mock('../foregroundService', () => ({
  ensureBatteryOptimizationExemption: mockEnsureBatteryOptimizationExemption,
  startForegroundService: mockStartForegroundService,
  stopForegroundService: mockStopForegroundService,
}));

jest.mock('../autoStop', () => ({
  DEVICE_ABANDONED_MS: 120_000,
  batteryShouldStop: jest.fn(() => false),
}));

jest.mock('../backoff', () => ({
  nextBackoffMs: jest.fn(() => 1),
}));

jest.mock('../watchdog', () => ({
  WATCHDOG_INTERVAL_MS: 10_000,
  freshWatchdogState: jest.fn(() => ({ frozenTicks: 0, lastPackets: 0, justReconnected: false })),
  stallTick: jest.fn((state) => ({ state, forceReconnect: false })),
}));

jest.mock('../../cloud/recovery', () => ({
  setActiveRecording: mockSetActiveRecording,
  clearActiveRecording: mockClearActiveRecording,
  writeSessionMeta: mockWriteSessionMeta,
}));

jest.mock('../../notifications/local', () => ({
  notifyDeviceDisconnected: mockNotifyDeviceDisconnected,
  notifyRecordingStopped: mockNotifyRecordingStopped,
}));

jest.mock('../diskSpace', () => ({
  InsufficientStorageError: class InsufficientStorageError extends Error {},
  checkDiskSpace: mockCheckDiskSpace,
}));

jest.mock('../../cloud/cloudSync', () => ({
  transmitSession: mockTransmitSession,
}));

jest.mock('../../cloud/streamStatsSidecar', () => ({
  writeStreamStatsSidecar: mockWriteStreamStatsSidecar,
}));

jest.mock('../recordingManifest', () => ({
  endMsFromManifest: jest.fn(() => 0),
  ensureRecordingManifest: jest.fn(() => ({ samplesWritten: 0 })),
  readRecordingManifest: jest.fn(() => null),
  statsFromManifest: jest.fn(() => ({
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
  })),
}));

jest.mock('../constants', () => ({
  EEG_SAMPLE_RATE_HZ: 250,
}));

jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => 'session-1'),
}));

type MockConnectedDevice = {
  deviceId: string;
  scale: { variantKnown: number; sampleRateHz: number };
  alarmControlAvailable: boolean;
  writeAlarmControl: jest.Mock<Promise<void>, [Uint8Array]>;
  startStream: jest.Mock<Promise<MockStreamHandle>, [string, unknown, unknown?]>;
  disconnect: jest.Mock<Promise<void>, []>;
};

type MockStreamHandle = {
  sessionDir: string;
  rawUri: string;
  imuUri: string | null;
  stop: jest.Mock<Promise<ReturnType<typeof makeStreamStats>>, []>;
};

function makeStreamStats() {
  return {
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
}

function makeHandle(): MockStreamHandle {
  return {
    sessionDir: '/tmp/session-1',
    rawUri: 'file:///tmp/session-1/raw.bin',
    imuUri: null,
    stop: jest.fn().mockResolvedValue(makeStreamStats()),
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('streamController wake-light reconnect sync', () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;
    jest.clearAllMocks();
    mockSessionState.wakeAlarm = { hour: 7, minute: 30, enabled: true };
    mockSessionState.streaming = null;
    mockSessionState.deviceBattery = null;
    mockUseSession.subscribe.mockReturnValue(jest.fn());
    mockBleManager.cancelDeviceConnection.mockResolvedValue(undefined);
  });

  it('sends CANCEL to the fresh device when the alarm is disabled during reconnect', async () => {
    const disconnectRef: { current: (() => void) | null } = { current: null };
    mockBleManager.onDeviceDisconnected.mockImplementation((_deviceId, listener) => {
      disconnectRef.current = listener as () => void;
      return { remove: jest.fn() };
    });

    const firstDeviceConnected = { current: true };
    const firstDevice: MockConnectedDevice = {
      deviceId: 'device-1',
      scale: { variantKnown: 1, sampleRateHz: 250 },
      alarmControlAvailable: true,
      writeAlarmControl: jest.fn((payload: Uint8Array) => {
        if (!firstDeviceConnected.current) {
          return Promise.reject(new Error(`device-1 disconnected after ${payload[0]}`));
        }
        return Promise.resolve();
      }),
      startStream: jest.fn().mockResolvedValue(makeHandle()),
      disconnect: jest.fn(async () => {
        firstDeviceConnected.current = false;
      }),
    };

    const secondDevice: MockConnectedDevice = {
      deviceId: 'device-1',
      scale: { variantKnown: 1, sampleRateHz: 250 },
      alarmControlAvailable: true,
      writeAlarmControl: jest.fn().mockResolvedValue(undefined),
      startStream: jest.fn().mockResolvedValue(makeHandle()),
      disconnect: jest.fn().mockResolvedValue(undefined),
    };

    const reconnectDeferred = deferred<MockConnectedDevice>();
    mockBleClient.connect
      .mockResolvedValueOnce(firstDevice)
      .mockImplementationOnce(() => reconnectDeferred.promise);

    const { startSession, stopSession, syncWakeLightForActiveSession } = await import('../streamController');

    try {
      await startSession('device-1');
      await flushPromises();

      const fireDisconnect = disconnectRef.current;
      if (!fireDisconnect) throw new Error('disconnect listener was not registered');
      fireDisconnect();
      await flushPromises();

      mockSessionState.wakeAlarm = { hour: 7, minute: 30, enabled: false };
      await syncWakeLightForActiveSession();

      reconnectDeferred.resolve(secondDevice);
      await flushPromises();
      await flushPromises();

      expect(secondDevice.writeAlarmControl).toHaveBeenCalledWith(encodeCancel());
    } finally {
      await stopSession();
    }
  });
});
