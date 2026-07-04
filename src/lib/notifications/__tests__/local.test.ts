const getPermissionsAsyncMock = jest.fn();
const setNotificationChannelAsyncMock = jest.fn();
const scheduleNotificationAsyncMock = jest.fn();

jest.mock('expo-notifications', () => ({
  AndroidImportance: {
    DEFAULT: 'DEFAULT',
  },
  getPermissionsAsync: () => getPermissionsAsyncMock(),
  setNotificationChannelAsync: (...args: unknown[]) => setNotificationChannelAsyncMock(...args),
  scheduleNotificationAsync: (...args: unknown[]) => scheduleNotificationAsyncMock(...args),
}));

jest.mock('react-native', () => ({
  Platform: {
    OS: 'android',
  },
}));

import { notifyRecordingStopped } from '../local';

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('notifyRecordingStopped', () => {
  beforeEach(() => {
    getPermissionsAsyncMock.mockReset();
    setNotificationChannelAsyncMock.mockReset();
    scheduleNotificationAsyncMock.mockReset();
    getPermissionsAsyncMock.mockResolvedValue({ status: 'granted' });
    setNotificationChannelAsyncMock.mockResolvedValue(undefined);
    scheduleNotificationAsyncMock.mockResolvedValue(undefined);
  });

  test('routes the stopped notification through the night via sessionId data', async () => {
    notifyRecordingStopped('device-lost', 'session-123');
    await flushMicrotasks();

    expect(setNotificationChannelAsyncMock).toHaveBeenCalledWith(
      'recording-alerts',
      expect.objectContaining({
        sound: undefined,
      }),
    );
    expect(scheduleNotificationAsyncMock).toHaveBeenCalledWith({
      content: expect.objectContaining({
        title: 'Recording stopped',
        data: { sessionId: 'session-123' },
      }),
      trigger: { channelId: 'recording-alerts', seconds: 1 },
    });
  });
});
