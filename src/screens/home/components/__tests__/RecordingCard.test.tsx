import React from 'react';
import { Text } from 'react-native';

import { DEVICE_ABANDONED_MS } from '../../../../lib/ble/autoStop';
import { noticeLines, type SessionEndNotice } from '../../../../lib/ble/sessionNotice';
import { Button } from '../../../../components/Button';
import { RecordingCard } from '../RecordingCard';

const { act, create } = require('react-test-renderer') as {
  act: (callback: () => void) => void;
  create: (element: React.ReactElement) => { root: any; toJSON: () => unknown };
};

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => undefined),
}));

jest.mock('expo-haptics', () => ({
  ImpactFeedbackStyle: { Light: 'light' },
  impactAsync: jest.fn(async () => undefined),
}));

jest.mock('../../../../lib/ble/streamController', () => ({
  startSession: jest.fn(),
  stopSession: jest.fn(),
}));

jest.mock('../../../../lib/cloud/cloudSync', () => ({
  transmitSession: jest.fn(),
}));

jest.mock('../../../../lib/files/recordingBundleExport', () => ({
  exportRecordingBundle: jest.fn(),
}));

const mockOpenNight = jest.fn();
jest.mock('../../../../navigation/navigationRef', () => ({
  openNight: (...args: unknown[]) => mockOpenNight(...args),
}));

type MockSessionState = {
  streaming: null;
  pairedDeviceId: string | null;
  pairedSerial: string | null;
  sessionNotice: SessionEndNotice | null;
  setSessionNotice: jest.Mock;
};

let mockSessionState: MockSessionState;

jest.mock('../../../../state/session', () => ({
  useSession: (selector: (state: MockSessionState) => unknown) => selector(mockSessionState),
}));

const baseNotice: SessionEndNotice = {
  sessionId: 'night-42',
  reason: 'device-lost',
  sessionStartMs: new Date(2026, 6, 2, 23, 0).getTime(),
  dataEndMs: new Date(2026, 6, 3, 2, 15).getTime(),
  disconnectAtMs: new Date(2026, 6, 3, 2, 15).getTime(),
  noticedAtMs: new Date(2026, 6, 3, 7, 0).getTime(),
  lastBatteryPct: 12,
};

describe('RecordingCard blocking notice overlay', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSessionState = {
      streaming: null,
      pairedDeviceId: 'device-1',
      pairedSerial: 'NX-001',
      sessionNotice: baseNotice,
      setSessionNotice: jest.fn(),
    };
  });

  test('shows the blocking notice and clears it when Got it is pressed', () => {
    const nowMs = new Date(2026, 6, 3, 8, 0).getTime();
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(nowMs);
    const { title, lines } = noticeLines(baseNotice, {
      abandonedMs: DEVICE_ABANDONED_MS,
      nowMs,
    });

    try {
      let tree!: ReturnType<typeof create>;
      act(() => {
        tree = create(<RecordingCard idleFooter={<Text>Footer</Text>} />);
      });

      expect(tree.root.findByProps({ children: title })).toBeTruthy();
      expect(tree.root.findByProps({ children: lines[0] })).toBeTruthy();
      expect(tree.root.findByProps({ children: lines[1] })).toBeTruthy();
      expect(tree.root.findByProps({ children: lines[2] })).toBeTruthy();
      expect(tree.root.findByProps({ children: 'Footer' })).toBeTruthy();
      expect(
        tree.root.findByProps({ accessibilityLabel: 'Dismiss night ended early notice' }),
      ).toBeTruthy();

      const gotIt = tree.root
        .findAllByType(Button)
        .find((node: any) => node.props.label === 'Got it');
      expect(gotIt).toBeTruthy();

      act(() => {
        gotIt?.props.onPress();
      });

      expect(mockSessionState.setSessionNotice).toHaveBeenCalledWith(null);
    } finally {
      nowSpy.mockRestore();
    }
  });

  test('hides the notice when the device is unpaired and View night clears before opening', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<RecordingCard />);
    });
    const viewNight = tree.root
      .findAllByType(Button)
      .find((node: any) => node.props.label === 'View night');

    expect(viewNight).toBeTruthy();

    act(() => {
      viewNight?.props.onPress();
    });

    expect(mockSessionState.setSessionNotice).toHaveBeenCalledWith(null);
    expect(mockOpenNight).toHaveBeenCalledWith(baseNotice.sessionId);

    mockSessionState.pairedDeviceId = null;
    let unpaired!: ReturnType<typeof create>;
    act(() => {
      unpaired = create(<RecordingCard />);
    });

    expect(unpaired.toJSON()).toBeNull();
  });
});
