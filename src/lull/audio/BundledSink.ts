/**
 * Bundled-soundscape audio sink (offline fallback) for the Lull wind-down.
 *
 * This is the fallback {@link AudioSink} used when no Spotify session is
 * available: it loops a single bundled soundscape bed and fades its volume to
 * silence as the user falls asleep. The sleepiness controller drives it through
 * the {@link AudioSink} contract, identical to {@link SpotifySink}, so the
 * engine stays sink-agnostic.
 *
 * Backed by an `expo-av` `Audio.Sound`:
 *   - construction       → `Audio.setAudioModeAsync({ playsInSilentModeIOS,
 *                            staysActiveInBackground, shouldDuckAndroid: false })`
 *   - `setVolume(v01)`   → `sound.setVolumeAsync(clamp01(v01))`
 *   - `mute()`           → `sound.setVolumeAsync(0)`
 *   - `stop()`           → `sound.stopAsync()` then `sound.unloadAsync()`
 *
 * The soundscape asset (`assets/lull/soundscape.m4a`) may not be present yet
 * (see `assets/lull/README.md`). The `require` is therefore guarded: if the
 * asset is missing the sink logs a warning and degrades to a no-op rather than
 * crashing the app.
 */
import { Audio as ExpoAudio, type AVPlaybackSource } from 'expo-av';

import type { AudioSink } from './AudioSink';

/**
 * The slice of the `expo-av` `Audio` namespace this sink depends on. Declaring
 * it explicitly documents the exact surface used and lets a caller inject a
 * substitute; production code uses the real `expo-av` export by default and
 * tests mock the module via `jest.mock('expo-av', ...)`.
 */
export interface AudioBackend {
  setAudioModeAsync: (mode: {
    playsInSilentModeIOS?: boolean;
    staysActiveInBackground?: boolean;
    shouldDuckAndroid?: boolean;
  }) => Promise<void>;
  Sound: {
    new (): SoundLike;
  };
}

/** The subset of `expo-av`'s `Audio.Sound` instance API this sink calls. */
export interface SoundLike {
  loadAsync(
    source: AVPlaybackSource,
    initialStatus?: { isLooping?: boolean; shouldPlay?: boolean; volume?: number },
    downloadFirst?: boolean,
  ): Promise<unknown>;
  setVolumeAsync(volume: number): Promise<unknown>;
  stopAsync(): Promise<unknown>;
  unloadAsync(): Promise<unknown>;
}

/** iOS/Android audio mode for an always-audible, background-capable wind-down. */
const LULL_AUDIO_MODE = {
  // Play even when the hardware ringer switch is silent — a sleep aid is useless
  // if the silent switch kills it.
  playsInSilentModeIOS: true,
  // Keep the audio session alive when the screen locks / app backgrounds. On iOS
  // this also requires the `audio` UIBackgroundMode (set in app.json).
  staysActiveInBackground: true,
  // Don't auto-duck for other apps' audio — Lull owns the bedtime soundstage.
  shouldDuckAndroid: false,
} as const;

/**
 * The bundled soundscape, loaded through a guarded `require` so a not-yet-added
 * asset cannot break the bundle/runtime. Resolves to the asset module id when
 * present, or `null` when the file is missing.
 */
function resolveSoundscapeSource(): AVPlaybackSource | null {
  try {
    return require('../../../assets/lull/soundscape.m4a') as AVPlaybackSource;
  } catch {
    return null;
  }
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

export class BundledSink implements AudioSink {
  private readonly audio: AudioBackend;
  private readonly source: AVPlaybackSource | null;
  private sound: SoundLike | null = null;
  /** Resolves once the initial audio-mode + load attempt has settled. */
  private readonly ready: Promise<void>;
  private stopped = false;

  /**
   * @param audio  Injectable `expo-av` `Audio` namespace (defaults to the real
   *               module). Tests pass a mock here.
   * @param source Optional explicit playback source; defaults to the guarded
   *               `require` of the bundled soundscape asset.
   */
  constructor(
    audio: AudioBackend = ExpoAudio as unknown as AudioBackend,
    source: AVPlaybackSource | null = resolveSoundscapeSource(),
  ) {
    this.audio = audio;
    this.source = source;
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    try {
      await this.audio.setAudioModeAsync({ ...LULL_AUDIO_MODE });
    } catch (err) {
      console.warn('[BundledSink] setAudioModeAsync failed:', err);
    }

    if (this.source == null) {
      console.warn(
        '[BundledSink] No bundled soundscape asset found ' +
          '(assets/lull/soundscape.m4a missing). Audio is disabled; ' +
          'drop a loopable .m4a there and rebuild. See assets/lull/README.md.',
      );
      return;
    }

    try {
      const sound = new this.audio.Sound();
      await sound.loadAsync(this.source, { isLooping: true, shouldPlay: true });
      // A late stop() (called before load finished) must win.
      if (this.stopped) {
        await sound.unloadAsync();
        return;
      }
      this.sound = sound;
    } catch (err) {
      console.warn('[BundledSink] Failed to load soundscape:', err);
    }
  }

  /** Set output volume; `v01` is clamped to [0, 1]. No-op if audio is disabled. */
  async setVolume(v01: number): Promise<void> {
    await this.ready;
    if (this.sound == null) return;
    await this.sound.setVolumeAsync(clamp01(v01));
  }

  /** Silence output immediately without tearing down the session. */
  async mute(): Promise<void> {
    await this.ready;
    if (this.sound == null) return;
    await this.sound.setVolumeAsync(0);
  }

  /** Stop playback and release the underlying sound. Idempotent. */
  async stop(): Promise<void> {
    this.stopped = true;
    await this.ready;
    const sound = this.sound;
    if (sound == null) return;
    this.sound = null;
    try {
      await sound.stopAsync();
    } finally {
      await sound.unloadAsync();
    }
  }
}
