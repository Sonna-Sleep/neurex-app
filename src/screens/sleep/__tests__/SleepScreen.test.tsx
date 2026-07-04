/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react-native';

import { SleepScreen } from '../SleepScreen';

type MockSessionState = {
  pairedDeviceId: string | null;
  pairedSerial: string | null;
  deviceBattery: number | null;
  streaming: unknown | null;
  setPaired: jest.Mock<void, [string | null, string?]>;
};

type FoundDevice = { deviceId: string; serial: string; rssi: number };

let mockSessionState: MockSessionState;
let mockScanCallback: ((device: FoundDevice) => void) | null = null;

const mockScan = jest.fn((cb: (device: FoundDevice) => void) => {
  mockScanCallback = cb;
  return jest.fn();
});

jest.mock('../../../state/session', () => {
  const useSession = (selector: (state: MockSessionState) => unknown) =>
    selector(mockSessionState);
  useSession.getState = () => mockSessionState;
  return { useSession };
});

jest.mock('../../../lib/ble', () => ({
  bleClient: {
    scan: (cb: (device: FoundDevice) => void) => mockScan(cb),
  },
}));

jest.mock('../../../lib/ble/manager', () => ({
  getBleManager: jest.fn(() => ({})),
}));

jest.mock('../../../lib/ble/permissions', () => ({
  checkBleAvailability: jest.fn(() => Promise.resolve({ state: 'ready' })),
  requestAndroidBlePermissions: jest.fn(() => Promise.resolve(true)),
}));

jest.mock('../../../components/Logo', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { Logo: () => <Text>logo</Text> };
});

jest.mock('../../../components/StatusPill', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { StatusPill: () => <Text>battery</Text> };
});

jest.mock('../../home/components/RecordingCard', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { RecordingCard: () => <Text>recording-card</Text> };
});

jest.mock('../../home/components/ConnectDeviceCard', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    ConnectDeviceCard: ({ onConnected }: { onConnected?: (device: FoundDevice) => void }) => (
      <Pressable
        accessibilityLabel="mock-connect-device"
        onPress={() =>
          onConnected?.({ deviceId: 'device-1', serial: 'Neurex Green', rssi: -45 })
        }
      >
        <Text>connect-device-card</Text>
      </Pressable>
    ),
  };
});

jest.mock('../components/WakeAlarmCard', () => {
  const React = require('react');
  const { Text } = require('react-native');
  return { WakeAlarmCard: () => <Text>wake-alarm-card</Text> };
});

describe('SleepScreen paired device presence', () => {
  beforeEach(() => {
    mockScanCallback = null;
    mockScan.mockClear();
    mockSessionState = {
      pairedDeviceId: 'device-1',
      pairedSerial: 'Neurex Green',
      deviceBattery: null,
      streaming: null,
      setPaired: jest.fn(),
    };
  });

  it('keeps a paired-but-unseen device in the honest search state', async () => {
    await render(<SleepScreen />);

    await waitFor(() => expect(mockScan).toHaveBeenCalledTimes(1));

    expect(screen.queryByText('recording-card')).toBeNull();
    expect(screen.queryByText('connect-device-card')).toBeNull();
    expect(screen.getByText('Looking for your Neurex device.')).toBeTruthy();
  });

  it('shows the recording controls after the paired device is actually seen by scan', async () => {
    await render(<SleepScreen />);

    await waitFor(() => expect(mockScanCallback).not.toBeNull());
    await act(async () => {
      mockScanCallback?.({ deviceId: 'device-1', serial: 'Neurex Green', rssi: -43 });
      await Promise.resolve();
    });

    await waitFor(() => expect(screen.getByText('recording-card')).toBeTruthy());
  });

  it('shows the device picker when no device is paired', async () => {
    mockSessionState.pairedDeviceId = null;
    mockSessionState.pairedSerial = null;

    await render(<SleepScreen />);

    expect(screen.getByText('connect-device-card')).toBeTruthy();
    expect(screen.queryByText('recording-card')).toBeNull();
  });
});
