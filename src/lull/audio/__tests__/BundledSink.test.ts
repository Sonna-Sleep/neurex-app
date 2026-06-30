/**
 * Unit tests for {@link BundledSink} with `expo-av` mocked.
 *
 * Pure unit test (no React Native / native runtime): `jest.mock('expo-av')`
 * replaces the native module with a fake `Audio.Sound` whose methods are jest
 * mocks, so we can assert the sink's calls. Runs under plain ts-jest.
 */

import { BundledSink } from '../BundledSink';

// Mock expo-av: jest hoists this factory above the import, so everything it
// needs is defined inside it. The captured Sound instances + setAudioModeAsync
// spy are exposed back on the module under a `__mock` handle (jest only allows
// `mock`-prefixed outer refs inside the factory).
jest.mock('expo-av', () => {
  const soundInstances: MockSound[] = [];
  class MockSound {
    loadAsync = jest.fn(async () => ({}));
    setVolumeAsync = jest.fn(async () => ({}));
    stopAsync = jest.fn(async () => ({}));
    unloadAsync = jest.fn(async () => ({}));
    constructor() {
      soundInstances.push(this);
    }
  }
  const setAudioModeAsync = jest.fn(async () => undefined);
  return {
    Audio: { setAudioModeAsync, Sound: MockSound },
    __mock: { soundInstances, setAudioModeAsync },
  };
});

interface MockSound {
  loadAsync: jest.Mock;
  setVolumeAsync: jest.Mock;
  stopAsync: jest.Mock;
  unloadAsync: jest.Mock;
}
const mockAv = jest.requireMock('expo-av') as {
  __mock: { soundInstances: MockSound[]; setAudioModeAsync: jest.Mock };
};
const soundInstances = mockAv.__mock.soundInstances;
const setAudioModeAsync = mockAv.__mock.setAudioModeAsync;

// A non-null placeholder source so the sink takes the "asset present" path.
// (The real assets/lull/soundscape.m4a is not committed yet; passing an
// explicit source lets us test the loaded-audio behaviors regardless.)
const FAKE_SOURCE = { uri: 'soundscape.m4a' } as unknown as never;

/** The Sound the sink created during this test's construction. */
function currentSound(): MockSound {
  return soundInstances[soundInstances.length - 1];
}

beforeEach(() => {
  soundInstances.length = 0;
  jest.clearAllMocks();
});

describe('BundledSink', () => {
  describe('audio mode', () => {
    it('configures the audio mode with staysActiveInBackground on construction', async () => {
      const sink = new BundledSink(undefined, FAKE_SOURCE);
      await sink.setVolume(1); // await readiness via any op

      expect(setAudioModeAsync).toHaveBeenCalledTimes(1);
      const mode = setAudioModeAsync.mock.calls[0][0] as Record<string, unknown>;
      expect(mode.staysActiveInBackground).toBe(true);
      expect(mode.playsInSilentModeIOS).toBe(true);
      expect(mode.shouldDuckAndroid).toBe(false);
    });
  });

  describe('playback', () => {
    it('loads a looping, playing sound', async () => {
      const sink = new BundledSink(undefined, FAKE_SOURCE);
      await sink.setVolume(0.5);

      const sound = currentSound();
      expect(sound.loadAsync).toHaveBeenCalledTimes(1);
      const initialStatus = sound.loadAsync.mock.calls[0][1] as {
        isLooping?: boolean;
        shouldPlay?: boolean;
      };
      expect(initialStatus.isLooping).toBe(true);
      expect(initialStatus.shouldPlay).toBe(true);
    });

    it('setVolume(0.3) -> setVolumeAsync(0.3)', async () => {
      const sink = new BundledSink(undefined, FAKE_SOURCE);
      await sink.setVolume(0.3);

      const sound = currentSound();
      expect(sound.setVolumeAsync).toHaveBeenCalledTimes(1);
      expect(sound.setVolumeAsync).toHaveBeenCalledWith(0.3);
    });

    it('clamps setVolume to [0, 1]', async () => {
      const sink = new BundledSink(undefined, FAKE_SOURCE);
      await sink.setVolume(1.7);
      await sink.setVolume(-0.4);

      const sound = currentSound();
      expect(sound.setVolumeAsync).toHaveBeenNthCalledWith(1, 1);
      expect(sound.setVolumeAsync).toHaveBeenNthCalledWith(2, 0);
    });

    it('mute() -> setVolumeAsync(0)', async () => {
      const sink = new BundledSink(undefined, FAKE_SOURCE);
      await sink.mute();

      const sound = currentSound();
      expect(sound.setVolumeAsync).toHaveBeenCalledTimes(1);
      expect(sound.setVolumeAsync).toHaveBeenCalledWith(0);
    });
  });

  describe('teardown', () => {
    it('stop() unloads (stopAsync then unloadAsync)', async () => {
      const sink = new BundledSink(undefined, FAKE_SOURCE);
      await sink.setVolume(0.5); // ensure loaded
      await sink.stop();

      const sound = currentSound();
      expect(sound.stopAsync).toHaveBeenCalledTimes(1);
      expect(sound.unloadAsync).toHaveBeenCalledTimes(1);
      // stopAsync must precede unloadAsync.
      const stopOrder = sound.stopAsync.mock.invocationCallOrder[0];
      const unloadOrder = sound.unloadAsync.mock.invocationCallOrder[0];
      expect(stopOrder).toBeLessThan(unloadOrder);
    });

    it('stop() is idempotent and post-stop ops are no-ops', async () => {
      const sink = new BundledSink(undefined, FAKE_SOURCE);
      await sink.setVolume(0.5);
      const sound = currentSound();

      await sink.stop();
      await sink.stop(); // second stop must not re-unload
      await sink.setVolume(0.2); // post-stop volume is a no-op

      expect(sound.unloadAsync).toHaveBeenCalledTimes(1);
      // Only the pre-stop setVolume(0.5) reached the sound.
      expect(sound.setVolumeAsync).toHaveBeenCalledTimes(1);
    });
  });

  describe('missing asset', () => {
    it('does not crash and degrades to a no-op when the asset is absent', async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      // source = null simulates the not-yet-added soundscape.m4a.
      const sink = new BundledSink(undefined, null);

      await expect(sink.setVolume(0.5)).resolves.toBeUndefined();
      await expect(sink.mute()).resolves.toBeUndefined();
      await expect(sink.stop()).resolves.toBeUndefined();

      // Audio mode is still configured, but no sound is ever created/touched.
      expect(setAudioModeAsync).toHaveBeenCalledTimes(1);
      expect(soundInstances.length).toBe(0);
      expect(warn).toHaveBeenCalled();

      warn.mockRestore();
    });
  });
});
