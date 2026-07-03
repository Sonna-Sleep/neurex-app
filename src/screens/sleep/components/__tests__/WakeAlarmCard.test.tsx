import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { WakeAlarmCard } from '../WakeAlarmCard';

type WakeAlarmSetting = { hour: number; minute: number; enabled: boolean };

const mockSyncWakeLightForActiveSession = jest.fn(() => Promise.resolve());

let mockSessionState: {
  wakeAlarm: WakeAlarmSetting | null;
  setWakeAlarm: jest.Mock<void, [WakeAlarmSetting | null]>;
};

jest.mock('../../../../state/session', () => {
  const useSession = (selector: (state: typeof mockSessionState) => unknown) =>
    selector(mockSessionState);
  useSession.getState = () => mockSessionState;
  return { useSession };
});

jest.mock('../../../../lib/ble/streamController', () => ({
  syncWakeLightForActiveSession: () => mockSyncWakeLightForActiveSession(),
}));

describe('WakeAlarmCard', () => {
  beforeEach(() => {
    mockSessionState = {
      wakeAlarm: null,
      setWakeAlarm: jest.fn((next: WakeAlarmSetting | null) => {
        mockSessionState.wakeAlarm = next;
      }),
    };
    mockSyncWakeLightForActiveSession.mockClear();
  });

  it('shows the default disabled 07:30 setting when no alarm is persisted', async () => {
    await render(<WakeAlarmCard />);

    expect(screen.getByText('Wake-up light')).toBeTruthy();
    expect(screen.getByText('07')).toBeTruthy();
    expect(screen.getByText('30')).toBeTruthy();
    expect(screen.getByLabelText('Wake-up light alarm toggle').props.value).toBe(false);
  });

  it('persists toggle changes from the default state and syncs the active session', async () => {
    await render(<WakeAlarmCard />);

    await fireEvent(screen.getByLabelText('Wake-up light alarm toggle'), 'valueChange', true);

    expect(mockSessionState.setWakeAlarm).toHaveBeenCalledWith({
      hour: 7,
      minute: 30,
      enabled: true,
    });
    expect(mockSyncWakeLightForActiveSession).toHaveBeenCalledTimes(1);
  });

  it('wraps the hour stepper from 0 back to 23 and syncs the active session', async () => {
    mockSessionState.wakeAlarm = { hour: 0, minute: 55, enabled: true };
    await render(<WakeAlarmCard />);

    await fireEvent.press(screen.getByLabelText('Decrease wake-up hour'));
    expect(mockSessionState.setWakeAlarm).toHaveBeenLastCalledWith({
      hour: 23,
      minute: 55,
      enabled: true,
    });
    expect(mockSyncWakeLightForActiveSession).toHaveBeenCalledTimes(1);
  });

  it('wraps the minute stepper from 55 forward to 00 and syncs the active session', async () => {
    mockSessionState.wakeAlarm = { hour: 23, minute: 55, enabled: true };
    await render(<WakeAlarmCard />);

    await fireEvent.press(screen.getByLabelText('Increase wake-up minute'));
    expect(mockSessionState.setWakeAlarm).toHaveBeenLastCalledWith({
      hour: 23,
      minute: 0,
      enabled: true,
    });
    expect(mockSyncWakeLightForActiveSession).toHaveBeenCalledTimes(1);
  });

  it('accumulates rapid repeated hour presses from the latest persisted alarm before rerender', async () => {
    mockSessionState.wakeAlarm = { hour: 7, minute: 30, enabled: true };
    const view = await render(<WakeAlarmCard />);

    const increaseHourButton = screen.getByLabelText('Increase wake-up hour');
    await fireEvent.press(increaseHourButton);
    await fireEvent.press(increaseHourButton);

    expect(mockSessionState.setWakeAlarm).toHaveBeenNthCalledWith(1, {
      hour: 8,
      minute: 30,
      enabled: true,
    });
    expect(mockSessionState.setWakeAlarm).toHaveBeenNthCalledWith(2, {
      hour: 9,
      minute: 30,
      enabled: true,
    });
    expect(mockSyncWakeLightForActiveSession).toHaveBeenCalledTimes(2);
    expect(mockSessionState.wakeAlarm).toEqual({
      hour: 9,
      minute: 30,
      enabled: true,
    });

    await view.unmount();
    await render(<WakeAlarmCard />);
    expect(screen.getByText('09')).toBeTruthy();
  });
});
