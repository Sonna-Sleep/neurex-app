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

import { noticeFromRecovery, type RecordingMeta, type RecoveryResult } from '../recovery';

const marker: RecordingMeta = {
  sessionId: 'session-1',
  startedAtMs: 1_000,
  disconnectAtMs: 4_500,
  lastBatteryPct: 17,
};

const result: RecoveryResult = {
  sessionId: 'session-1',
  ok: true,
  startedAtMs: 1_200,
  endMs: 4_000,
};

describe('noticeFromRecovery', () => {
  test('returns a device-lost notice from the marker disconnect stamp and battery', () => {
    expect(
      noticeFromRecovery({
        marker,
        results: [result],
        liveOrRestoringSessionId: null,
        nowMs: 9_000,
      }),
    ).toEqual({
      sessionId: 'session-1',
      reason: 'device-lost',
      sessionStartMs: 1_200,
      dataEndMs: 4_000,
      disconnectAtMs: 4_500,
      noticedAtMs: 9_000,
      lastBatteryPct: 17,
    });
  });

  test('returns an interrupted notice when the marker has no disconnect stamp', () => {
    expect(
      noticeFromRecovery({
        marker: {
          sessionId: 'session-1',
          startedAtMs: 1_000,
        },
        results: [result],
        liveOrRestoringSessionId: null,
        nowMs: 9_000,
      }),
    ).toEqual({
      sessionId: 'session-1',
      reason: 'interrupted',
      sessionStartMs: 1_200,
      dataEndMs: 4_000,
      disconnectAtMs: 4_000,
      noticedAtMs: 9_000,
      lastBatteryPct: null,
    });
  });

  test('returns null when there is no marker', () => {
    expect(
      noticeFromRecovery({
        marker: null,
        results: [result],
        liveOrRestoringSessionId: null,
        nowMs: 9_000,
      }),
    ).toBeNull();
  });

  test('returns null when the marker belongs to the live or restoring session', () => {
    expect(
      noticeFromRecovery({
        marker,
        results: [result],
        liveOrRestoringSessionId: 'session-1',
        nowMs: 9_000,
      }),
    ).toBeNull();
  });

  test('returns null when the marker session has no matching recovery result', () => {
    expect(
      noticeFromRecovery({
        marker,
        results: [
          {
            sessionId: 'session-2',
            ok: true,
            startedAtMs: 2_000,
            endMs: 5_000,
          },
        ],
        liveOrRestoringSessionId: null,
        nowMs: 9_000,
      }),
    ).toBeNull();
  });
});
