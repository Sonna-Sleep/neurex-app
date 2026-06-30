/**
 * Lull engine — the live glue between the BLE EEG stream and the audio sink.
 *
 * Pipeline (mirrors the Phase-1 laptop `cli.run_loop`, but driven by live
 * packets instead of an offline file):
 *
 *   BLE packet.samples  →  feed()  →  rolling Fp / HEOG buffers
 *                       →  16 s windows formed at 1 Hz (from the device fs)
 *                       →  SleepinessEstimator.update -> { W, onset }
 *                       →  VolumeRatchet.update       -> volume (one-way down)
 *                       →  sink.setVolume(v) every tick
 *                       →  sink.mute() on the FIRST onset, then stop
 *
 * Per-channel math (montage roles from the Scale char `channel_role[]`):
 *   fp   = mean(Fp1, Fp2)        — the frontal EEG the W estimator runs on
 *   heog = EOG-L − EOG-R         — the horizontal-EOG that drives onset
 * Legacy single-channel devices carry only `Fp1`; then `fp = Fp1` and
 * `heog = 0` (no EOG corroboration, but W still computes).
 *
 * PURE-ish: this class itself has no wall-clock and no BLE/audio imports — the
 * audio side is the injected {@link AudioSink}, and time advances by the fixed
 * `update_sec` logical step (1 Hz), exactly like the golden-vector contract.
 * The only side effects are the sink calls and the optional `onTick` callback.
 */

import type { EegSample } from '../../lib/ble/types';
import { SleepinessEstimator, type LullParams } from '../core/sleepiness';
import { VolumeRatchet } from '../core/volume';
import type { AudioSink } from '../audio/AudioSink';
import { setLullFeed, clearLullFeed } from './engineTap';

/** One engine tick, surfaced to the UI/store via the `onTick` callback. */
export interface LullTick {
  /** Logical time in seconds since the engine started (advances by update_sec). */
  tSec: number;
  /** Smoothed wakefulness score W ∈ [0,1] (1 = alert). */
  W: number;
  /** Current sink volume in [0,1]. */
  volume: number;
  /** True once sleep onset has latched (never un-latches). */
  onset: boolean;
}

export type LullTickHandler = (tick: LullTick) => void;

/**
 * Resolve `fp` / `heog` from one decoded sample's role-keyed channel map.
 *   fp   = mean(Fp1, Fp2)   (falls back to Fp1 alone, then fp1_uV)
 *   heog = EOG-L − EOG-R     (0 when the EOG pair is absent — legacy devices)
 */
function deriveFpHeog(s: EegSample): { fp: number; heog: number } {
  const ch = s.channels ?? {};
  const fp1 = ch['Fp1'];
  const fp2 = ch['Fp2'];
  let fp: number;
  if (fp1 !== undefined && fp2 !== undefined) fp = (fp1 + fp2) / 2;
  else if (fp1 !== undefined) fp = fp1;
  else fp = s.fp1_uV;

  const eogL = ch['EOG-L'];
  const eogR = ch['EOG-R'];
  const heog = eogL !== undefined && eogR !== undefined ? eogL - eogR : 0;

  return { fp, heog };
}

export class LullEngine {
  private readonly params: LullParams;
  private readonly sink: AudioSink;
  private readonly onTick?: LullTickHandler;

  private readonly fs: number;
  /** Samples per analysis window (window_sec · fs). */
  private readonly windowSamples: number;
  /** Samples between consecutive ticks (update_sec · fs) — the 1 Hz hop. */
  private readonly hopSamples: number;

  private readonly estimator: SleepinessEstimator;
  private readonly ratchet: VolumeRatchet;

  // Rolling buffers of derived fp / heog samples, trimmed to windowSamples.
  private fpBuf: number[] = [];
  private heogBuf: number[] = [];
  // New samples accumulated since the last tick — when this reaches hopSamples
  // (and the window is full) we emit a tick and decrement by hopSamples.
  private sinceTick = 0;

  private running = false;
  private stopped = false;
  private muted = false;
  private tSec = 0;

  // Stable bound reference so the live-tap registry can register AND later
  // clear exactly this engine's feed (identity comparison in clearLullFeed).
  private readonly boundFeed: (samples: EegSample[]) => void;

  /**
   * @param params  lull_params.json (constants).
   * @param sink    audio backend to drive (Spotify / bundled / fake).
   * @param fs      device sample rate (Hz). Pass the Scale char's
   *                `sampleRateHz`; defaults to `params.fs_default`.
   * @param onTick  optional per-tick callback (drives lullStore / UI).
   */
  constructor(params: LullParams, sink: AudioSink, fs?: number, onTick?: LullTickHandler) {
    this.params = params;
    this.sink = sink;
    this.onTick = onTick;
    this.fs = fs && fs > 0 ? fs : params.fs_default;
    this.windowSamples = Math.max(1, Math.round(params.window_sec * this.fs));
    this.hopSamples = Math.max(1, Math.round(params.update_sec * this.fs));
    this.estimator = new SleepinessEstimator(this.fs, params);
    this.ratchet = new VolumeRatchet(params);
    this.boundFeed = (samples) => this.feed(samples);
  }

  /**
   * Begin accepting samples and register the live BLE tap so the stream
   * controller forwards packets here. Idempotent; a no-op after stop().
   */
  start(): void {
    if (this.stopped) return;
    this.running = true;
    setLullFeed(this.boundFeed);
  }

  /**
   * Stop the engine permanently: ignore further feed() calls and release the
   * sink. Idempotent. Returns the sink.stop() promise so callers may await it.
   */
  stop(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    this.running = false;
    this.stopped = true;
    clearLullFeed(this.boundFeed);
    return Promise.resolve(this.sink.stop()).catch(() => undefined);
  }

  /** True once the engine has muted on onset and torn down (terminal state). */
  get isStopped(): boolean {
    return this.stopped;
  }

  /**
   * Feed a batch of live samples (one BLE packet's worth). Accumulates the
   * derived fp/heog, forms 16 s windows at the 1 Hz update cadence, and runs
   * the estimator + ratchet per window. No-op unless the engine is running.
   */
  feed(samples: EegSample[]): void {
    if (!this.running || this.stopped) return;
    for (const s of samples) {
      const { fp, heog } = deriveFpHeog(s);
      this.fpBuf.push(fp);
      this.heogBuf.push(heog);
      this.sinceTick += 1;
      // Keep only the trailing window's worth of samples.
      if (this.fpBuf.length > this.windowSamples) {
        this.fpBuf.shift();
        this.heogBuf.shift();
      }
      // Emit a tick once we both have a full window AND have advanced one hop.
      if (this.fpBuf.length >= this.windowSamples && this.sinceTick >= this.hopSamples) {
        this.sinceTick -= this.hopSamples;
        this.tick();
      }
    }
  }

  /** Run one analysis window through estimator → ratchet → sink. */
  private tick(): void {
    if (this.stopped) return;
    this.tSec += this.params.update_sec;
    const fpWin = this.fpBuf.slice();
    const heogWin = this.heogBuf.slice();

    const out = this.estimator.update(fpWin, heogWin, this.tSec);
    const volume = this.ratchet.update(out.W, out.onset, this.params.update_sec);

    // Drive the audio sink every tick. Fire-and-forget: a transient sink error
    // (e.g. Spotify 404 no-active-device) must not crash the EEG pipeline.
    void Promise.resolve(this.sink.setVolume(volume)).catch(() => undefined);

    this.onTick?.({ tSec: this.tSec, W: out.W, volume, onset: out.onset });

    // First onset → mute and stop. (The ratchet keeps fading volume to 0 too,
    // but the explicit mute is the hard "asleep" cutoff per the Phase-2 spec.)
    if (out.onset && !this.muted) {
      this.muted = true;
      void Promise.resolve(this.sink.mute()).catch(() => undefined);
      void this.stop();
    }
  }
}
