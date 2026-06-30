/**
 * Stable audio-output interface for the Lull engine.
 *
 * The sleepiness controller drives an `AudioSink` without knowing whether the
 * audio is coming from Spotify (remote control) or a bundled local track. Both
 * backends implement this same contract so the controller stays sink-agnostic.
 *
 * `v01` is a normalized linear gain in [0, 1].
 */
export interface AudioSink {
  /** Set output volume. `v01` is clamped to [0, 1] by the implementation. */
  setVolume(v01: number): Promise<void>;
  /** Silence output immediately without tearing down the session. */
  mute(): Promise<void>;
  /** Stop playback and release the underlying audio session/resources. */
  stop(): Promise<void>;
}
