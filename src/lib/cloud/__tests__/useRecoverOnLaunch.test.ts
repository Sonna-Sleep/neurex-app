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

import React from 'react';

import type { RecordingMeta, RecoveryResult } from '../recovery';
import { useRecoverOnLaunch } from '../useRecoverOnLaunch';
import {
  clearActiveRecording,
  getActiveRecording,
  getLiveOrRestoringSessionId,
  recoverAll,
} from '../recovery';
import { activeOrRestoringSessionId } from '../../ble/streamController';

const { act, create } = require('react-test-renderer') as {
  act: (callback: () => Promise<void> | void) => Promise<void>;
  create: (element: React.ReactElement) => unknown;
};

const sessionState = {
  authReady: true,
  authStatus: 'signed-in' as const,
  streaming: null,
};

var mockSetSessionNotice: jest.Mock;
var mockUseSession: jest.Mock & { getState: () => { setSessionNotice: jest.Mock } };

jest.mock('../../../state/session', () => ({
  useSession: (() => {
    mockSetSessionNotice = jest.fn();
    mockUseSession = Object.assign(
      jest.fn((selector: (state: typeof sessionState) => unknown) => selector(sessionState)),
      {
        getState: () => ({ setSessionNotice: mockSetSessionNotice }),
      },
    );
    return mockUseSession;
  })(),
}));

jest.mock('../../ble/streamController', () => ({
  activeOrRestoringSessionId: jest.fn(),
}));

jest.mock('../recovery', () => {
  const actual = jest.requireActual('../recovery');
  return {
    ...actual,
    clearActiveRecording: jest.fn(),
    getActiveRecording: jest.fn(),
    getLiveOrRestoringSessionId: jest.fn(),
    recoverAll: jest.fn(),
  };
});

function HookHarness(): null {
  useRecoverOnLaunch();
  return null;
}

async function flushEffects(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('useRecoverOnLaunch', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('does not clear the marker or show a notice when restore claims it during recovery grace', async () => {
    const marker: RecordingMeta = {
      sessionId: 'session-1',
      startedAtMs: 1_000,
    };
    const results: RecoveryResult[] = [
      {
        sessionId: 'session-1',
        ok: true,
        startedAtMs: 1_000,
        endMs: 5_000,
      },
    ];
    let liveOrRestoringSessionId: string | null = null;

    (getActiveRecording as jest.MockedFunction<typeof getActiveRecording>).mockResolvedValue(marker);
    (recoverAll as jest.MockedFunction<typeof recoverAll>).mockImplementation(async () => {
      liveOrRestoringSessionId = marker.sessionId;
      return results;
    });
    (
      activeOrRestoringSessionId as jest.MockedFunction<typeof activeOrRestoringSessionId>
    ).mockImplementation(() => liveOrRestoringSessionId);
    (
      getLiveOrRestoringSessionId as jest.MockedFunction<typeof getLiveOrRestoringSessionId>
    ).mockImplementation(async () => liveOrRestoringSessionId);

    create(React.createElement(HookHarness));
    await flushEffects();

    expect(mockSetSessionNotice).not.toHaveBeenCalled();
    expect(clearActiveRecording).not.toHaveBeenCalled();
  });
});
