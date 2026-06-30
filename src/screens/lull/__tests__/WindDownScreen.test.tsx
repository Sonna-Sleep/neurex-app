/**
 * WindDownScreen render test (React Native Testing Library v14, jest-expo).
 *
 * Asserts the screen renders the right copy + controls for each Lull phase, all
 * driven purely by `lullStore`:
 *   - idle        → "Wind down" + sink picker + "Start wind down"
 *   - calibrating → "Calibrating" + live metrics + "Stop"
 *   - winddown    → "Winding down" + "Stop"
 *   - asleep      → "Asleep — muted" (terminal) + "Done", NO Start control
 *
 * The store is the single source of truth for phase, so we set it directly and
 * mount — no engine, no BLE, no audio is exercised here (those have their own
 * unit tests). Audio sinks and the Lull engine are mocked so mounting never
 * touches native modules or the network.
 *
 * RTL v14 note: `render`, `fireEvent`, `rerender`, and `unmount` are async and
 * MUST be awaited (the v14 migration drops the synchronous React-18 API). Every
 * test is `async`; queries (`getByText`/`queryByText`) stay synchronous.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';

import { WindDownScreen } from '../WindDownScreen';
import { useLull, type LullPhase } from '../../../lull/state/lullStore';
import * as streamController from '../../../lib/ble/streamController';

// Mock session store so the test never touches AsyncStorage.
const sessionMockState = {
  pairedDeviceId: 'dev-1' as string | null,
  pairedSerial: 'SN1',
  streaming: null as { sessionId: string } | null,
};

jest.mock('../../../state/session', () => ({
  useSession: Object.assign(
    (selector: (s: { pairedDeviceId: string | null; pairedSerial: string }) => unknown) =>
      selector(sessionMockState),
    {
      getState: () => ({ streaming: sessionMockState.streaming }),
    },
  ),
}));

// The screen constructs a CloudLullSession + audio sinks on Start; stub them so
// the render test stays a pure UI test (and never imports expo-av / fetch).
jest.mock('../../../lull/engine/CloudLullSession', () => ({
  CloudLullSession: jest.fn().mockImplementation(() => ({
    start: jest.fn(),
    stop: jest.fn(() => Promise.resolve()),
  })),
}));
jest.mock('../../../lib/ble/streamController', () => ({
  startSession: jest.fn(() => Promise.resolve({ sessionId: 's1' })),
  stopSession: jest.fn(() => Promise.resolve()),
  isSessionActive: jest.fn(() => false),
}));
jest.mock('../../../lull/audio/SpotifySink', () => ({
  SpotifySink: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../../lull/audio/BundledSink', () => ({
  BundledSink: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../../lull/audio/spotifyAuth', () => ({
  authorize: jest.fn(() => Promise.resolve(null)),
  isConnected: jest.fn(() => Promise.resolve(false)),
}));

/** Minimal native-stack navigation prop the screen reads (goBack + navigate). */
function makeNav() {
  return {
    goBack: jest.fn(),
    navigate: jest.fn(),
  } as never;
}

async function renderAt(
  phase: LullPhase,
  overrides: Partial<{ W: number; volume: number }> = {},
) {
  useLull.setState({
    phase,
    W: overrides.W ?? 0.8,
    volume: overrides.volume ?? 0.6,
    sink: 'bundled',
  });
  await render(
    <WindDownScreen navigation={makeNav()} route={{ key: 'Lull', name: 'Lull' } as never} />,
  );
  // The screen kicks off an async isConnected() probe on mount; let it settle so
  // its setState doesn't fire outside act() after the test body.
  await waitFor(() => expect(screen.toJSON()).toBeTruthy());
}

// Typed helpers for the streamController mock fns (jest-expo TS env lacks jest.Mock).
const mockIsSessionActive = streamController.isSessionActive as unknown as {
  mockReturnValue: (v: boolean) => void;
};
const mockStartSession = streamController.startSession as unknown as {
  mockResolvedValue: (v: { sessionId: string }) => void;
  mock: { calls: unknown[][] };
};

afterEach(() => {
  useLull.getState().reset();
  // Reset per-test mock overrides back to defaults.
  sessionMockState.pairedDeviceId = 'dev-1';
  sessionMockState.streaming = null;
  mockIsSessionActive.mockReturnValue(false);
  mockStartSession.mockResolvedValue({ sessionId: 's1' });
});

describe('WindDownScreen', () => {
  it('idle: shows the wind-down intro, sink picker, and Start control', async () => {
    await renderAt('idle');

    expect(screen.getByText('Wind down')).toBeTruthy();
    // Sink picker chips.
    expect(screen.getByText('Spotify')).toBeTruthy();
    expect(screen.getByText('Built-in')).toBeTruthy();
    // Primary action.
    expect(screen.getByText('Start wind down')).toBeTruthy();
    // No terminal / running controls yet.
    expect(screen.queryByText('Stop')).toBeNull();
    expect(screen.queryByText('Done')).toBeNull();
  });

  it('calibrating: shows the calibrating copy, live metrics, and Stop', async () => {
    await renderAt('calibrating', { W: 0.92, volume: 1 });

    expect(screen.getByText('Calibrating')).toBeTruthy();
    expect(screen.getByText(/Learning your awake baseline/i)).toBeTruthy();
    // Live metrics (Awake % + Volume %) appear once active.
    expect(screen.getByText('Awake')).toBeTruthy();
    expect(screen.getByText('Volume')).toBeTruthy();
    expect(screen.getByText('92%')).toBeTruthy();
    expect(screen.getByText('100%')).toBeTruthy();
    // Running control is Stop; no Start / Done.
    expect(screen.getByText('Stop')).toBeTruthy();
    expect(screen.queryByText('Start wind down')).toBeNull();
    expect(screen.queryByText('Done')).toBeNull();
  });

  it('winddown: shows the winding-down copy and Stop', async () => {
    await renderAt('winddown', { W: 0.3, volume: 0.4 });

    expect(screen.getByText('Winding down')).toBeTruthy();
    expect(screen.getByText(/The music fades as you drift off/i)).toBeTruthy();
    expect(screen.getByText('Stop')).toBeTruthy();
    expect(screen.queryByText('Start wind down')).toBeNull();
  });

  it('asleep: shows the terminal muted state and Done (no Start/Stop)', async () => {
    await renderAt('asleep', { W: 0.05, volume: 0 });

    expect(screen.getByText('Asleep — muted')).toBeTruthy();
    expect(screen.getByText(/Sleep onset detected/i)).toBeTruthy();
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.queryByText('Start wind down')).toBeNull();
    expect(screen.queryByText('Stop')).toBeNull();
  });

  it('Start moves the store into the calibrating phase', async () => {
    await renderAt('idle');
    await fireEvent.press(screen.getByText('Start wind down'));
    expect(useLull.getState().phase).toBe('calibrating');
  });

  it('Done dismisses the modal from the asleep state', async () => {
    const nav = makeNav();
    useLull.setState({ phase: 'asleep', W: 0, volume: 0, sink: 'bundled' });
    await render(
      <WindDownScreen navigation={nav} route={{ key: 'Lull', name: 'Lull' } as never} />,
    );
    await waitFor(() => expect(screen.toJSON()).toBeTruthy());
    await fireEvent.press(screen.getByText('Done'));
    expect((nav as unknown as { goBack: () => void }).goBack).toHaveBeenCalled();
  });

  it('Start with no paired headband shows an error and starts no session', async () => {
    sessionMockState.pairedDeviceId = null;
    mockIsSessionActive.mockReturnValue(false);

    await renderAt('idle');
    await fireEvent.press(screen.getByText('Start wind down'));

    expect(screen.getByText(/Pair your Neurex headband first/i)).toBeTruthy();
    expect((mockStartSession as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(0);
    expect(useLull.getState().phase).toBe('idle');
  });

  it('Start taps an already-active session without starting a second one', async () => {
    mockIsSessionActive.mockReturnValue(true);
    sessionMockState.streaming = { sessionId: 's1' };

    await renderAt('idle');
    await fireEvent.press(screen.getByText('Start wind down'));

    await waitFor(() => { if (useLull.getState().phase !== 'calibrating') throw new Error('not yet'); });
    expect(useLull.getState().phase).toBe('calibrating');
    expect((mockStartSession as unknown as { mock: { calls: unknown[][] } }).mock.calls).toHaveLength(0);
  });
});
