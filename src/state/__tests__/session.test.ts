const mockPair = jest.fn();
const mockSignOut = jest.fn().mockResolvedValue(undefined);
const mockLocalWipe = jest.fn().mockResolvedValue(undefined);
const mockClearActiveRecording = jest.fn().mockResolvedValue(undefined);
const mockClearPushTokenRegistration = jest.fn().mockResolvedValue(undefined);

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
  removeItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../lib/repos', () => ({
  deviceRepo: {
    pair: mockPair,
  },
}));

jest.mock('../../lib/auth/supabase', () => ({
  getSupabase: jest.fn(() => ({
    auth: {
      signOut: mockSignOut,
    },
  })),
}));

jest.mock('../../lib/accountDeletion', () => ({
  localWipe: mockLocalWipe,
}));

jest.mock('../../lib/cloud/recovery', () => ({
  clearActiveRecording: mockClearActiveRecording,
}));

jest.mock('../../lib/push/registerPushToken', () => ({
  clearPushTokenRegistration: mockClearPushTokenRegistration,
}));

describe('session wake alarm persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
  });

  it('clears the persisted wake alarm on sign-out so it cannot leak to another user', async () => {
    const { useSession } = await import('../session');

    useSession.setState({
      authStatus: 'signed-in',
      user: { id: 'user-1', email: 'a@example.com', name: 'A' },
      pairedSerial: 'Neurex White',
      pairedDeviceId: 'device-1',
      onboardingComplete: true,
      streaming: null,
      deviceBattery: 77,
      unviewedNightIds: ['night-1'],
      wakeAlarm: { hour: 6, minute: 45, enabled: true },
    });

    useSession.getState().signOut();

    expect(useSession.getState().wakeAlarm).toBeNull();
  });

  it('drops malformed persisted wake alarms during merge', async () => {
    const { useSession } = await import('../session');
    const options = useSession.persist.getOptions();
    const merged = options.merge?.(
      {
        wakeAlarm: { hour: 99, minute: 30, enabled: true },
      },
      useSession.getInitialState(),
    );

    expect(merged?.wakeAlarm).toBeNull();
  });
});
