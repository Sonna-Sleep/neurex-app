/**
 * LullEngine integration test — the live EEG → W → ratchet → sink loop.
 *
 * Mirrors the Phase-1 Python `tests/test_loop.py`: drive a synthetic
 * alert→drowsy `EegSample[]` sequence through the engine with a FakeSink and
 * assert the wind-down contract:
 *   (a) the sink volume is monotonic NON-INCREASING across the whole run
 *       (the one-way ratchet never turns the music back up), and
 *   (b) the sink is MUTED after sleep onset (the "asleep" cutoff).
 *
 * The input is the same deterministic plan the golden-vector contract uses
 * (gen_golden.py): a long alert phase covering calibration, then a drowsy phase
 * long enough to cross the onset dwell. Inputs are fed as a continuous sample
 * stream (one BLE packet's worth at a time) so the engine's own 16 s / 1 Hz
 * windowing is exercised end-to-end — exactly how live BLE packets arrive.
 *
 * Runs under plain ts-jest (node env) — same setup as the Lull audio sink tests.
 */

import { LullEngine } from '../LullEngine';
import { isLullActive } from '../engineTap';
import type { AudioSink } from '../../audio/AudioSink';
import type { EegSample } from '../../../lib/ble/types';
import paramsJson from '../../lull_params.json';
import type { LullParams } from '../../core/sleepiness';

const params = paramsJson as unknown as LullParams;
const FS = 250;

/** Records every setVolume/mute/stop call so we can assert the contract. */
class FakeSink implements AudioSink {
  readonly volumes: number[] = [];
  muted = false;
  stopped = false;
  muteAtIndex: number | null = null;

  async setVolume(v01: number): Promise<void> {
    this.volumes.push(v01);
  }
  async mute(): Promise<void> {
    this.muted = true;
    // Remember the volume-history length at the moment of muting, so the test
    // can prove every recorded volume is non-increasing right up to onset.
    if (this.muteAtIndex === null) this.muteAtIndex = this.volumes.length;
  }
  async stop(): Promise<void> {
    this.stopped = true;
  }
}

/**
 * Build a contiguous block of `n` samples at a given EEG freq / EOG freq+amp,
 * starting at sample index `startIdx` (so phase is continuous across calls).
 * Channels carry the full 4-role montage so the engine derives
 * fp = mean(Fp1,Fp2) and heog = EOG-L − EOG-R exactly like live data.
 */
function block(
  eegHz: number,
  eogHz: number,
  eogAmp: number,
  n: number,
  startIdx: number,
): EegSample[] {
  const out: EegSample[] = [];
  for (let i = 0; i < n; i++) {
    const idx = startIdx + i;
    const t = idx / FS;
    const fp = Math.sin(2 * Math.PI * eegHz * t);
    const eog = eogAmp * Math.sin(2 * Math.PI * eogHz * t);
    out.push({
      ms: Math.round((idx / FS) * 1000),
      fp1_uV: fp,
      channels: {
        Fp1: fp,
        Fp2: fp,
        // Put the whole horizontal-EOG swing on EOG-L so EOG-L − EOG-R = eog.
        'EOG-L': eog,
        'EOG-R': 0,
      },
    });
  }
  return out;
}

describe('LullEngine wind-down loop', () => {
  it('drives a monotonic non-increasing volume and mutes after onset', async () => {
    const sink = new FakeSink();
    const ticks: { W: number; volume: number; onset: boolean }[] = [];
    const engine = new LullEngine(params, sink, FS, (t) =>
      ticks.push({ W: t.W, volume: t.volume, onset: t.onset }),
    );

    engine.start();
    expect(isLullActive()).toBe(true);

    const hop = Math.round(params.update_sec * FS); // 250 samples = 1 s @ 1 Hz

    // Alert phase: covers calibration + headroom (mirrors gen_golden plan).
    const nAlert = Math.floor((params.calib_seconds + 15) / params.update_sec);
    // Drowsy phase: long enough to cross dwell_sec (60 s) and fully fade.
    const nDrowsy = 300;

    let idx = 0;
    const feedStep = (eegHz: number, eogHz: number, eogAmp: number): void => {
      // One BLE packet's worth (hop = 1 s) per logical step; the engine forms
      // its own trailing 16 s window from the continuous stream.
      engine.feed(block(eegHz, eogHz, eogAmp, hop, idx));
      idx += hop;
    };

    for (let i = 0; i < nAlert; i++) feedStep(20.0, 3.0, 4.0);
    for (let i = 0; i < nDrowsy && !engine.isStopped; i++) feedStep(6.0, 0.3, 4.0);

    // Let the fire-and-forget sink promises settle.
    await new Promise((r) => setImmediate(r));

    // The engine emitted ticks for every full-window hop.
    expect(ticks.length).toBeGreaterThan(0);
    expect(sink.volumes.length).toBeGreaterThan(0);

    // (a) Volume never increases across the whole run.
    for (let i = 1; i < sink.volumes.length; i++) {
      expect(sink.volumes[i]).toBeLessThanOrEqual(sink.volumes[i - 1] + 1e-9);
    }

    // (b) Onset was detected and the sink was muted.
    const onsetReached = ticks.some((t) => t.onset);
    expect(onsetReached).toBe(true);
    expect(sink.muted).toBe(true);

    // (c) Muting drove the engine to its terminal state and released the sink +
    //     the live tap (no leak into a later recording).
    expect(engine.isStopped).toBe(true);
    expect(sink.stopped).toBe(true);
    expect(isLullActive()).toBe(false);
  });

  it('is a no-op before start() and after stop()', async () => {
    const sink = new FakeSink();
    const engine = new LullEngine(params, sink, FS);

    // Before start: feed is ignored.
    engine.feed(block(20, 3, 4, 4096, 0));
    expect(sink.volumes.length).toBe(0);
    expect(isLullActive()).toBe(false);

    // After stop: feed is ignored, sink released, tap cleared.
    engine.start();
    await engine.stop();
    engine.feed(block(20, 3, 4, 4096, 0));
    expect(sink.volumes.length).toBe(0);
    expect(sink.stopped).toBe(true);
    expect(isLullActive()).toBe(false);
  });
});
