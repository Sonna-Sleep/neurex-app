/**
 * Lull volume engine: one-way ratchet + onset fade. PURE / deterministic.
 *
 * Faithful port of the Phase-1 Python source of truth `tools/lull/volume.py`.
 * Constants come from params.volume. No I/O, no wall-clock — dt is supplied.
 */

import type { LullParams } from './sleepiness';

function smoothstep(u: number): number {
  const c = Math.min(1.0, Math.max(0.0, u));
  return c * c * (3.0 - 2.0 * c);
}

export class VolumeRatchet {
  private readonly v: LullParams['volume'];
  volume: number;
  private fading = false;

  constructor(params: LullParams) {
    this.v = params.volume;
    this.volume = this.v.v_max;
  }

  private target(W: number): number {
    const v = this.v;
    const u = (W - v.w_lo) / (v.w_hi - v.w_lo + 1e-12);
    return v.v_max * Math.pow(smoothstep(u), v.gamma);
  }

  /**
   * Advance the engine by dt seconds. Returns the new volume in [0, v_max].
   * Once onset fires (or a fade is already in progress) the volume fades
   * permanently to 0 over onset_fade_sec; otherwise it ratchets only downward
   * toward the smoothstep target, never increasing.
   */
  update(W: number, onset: boolean, dt: number): number {
    const v = this.v;
    if (onset || this.fading) {
      this.fading = true;
      const step = (v.v_max * dt) / Math.max(v.onset_fade_sec, 1e-6);
      this.volume = Math.max(0.0, this.volume - step);
      return this.volume;
    }

    const target = this.target(W);
    if (target < this.volume) {
      // ratchet: only ever down
      const maxDrop = v.max_down_slew_per_sec * dt;
      this.volume = Math.max(target, this.volume - maxDrop);
    }
    return this.volume;
  }
}
