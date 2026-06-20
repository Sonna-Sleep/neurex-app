// Live electrode-contact quality from the FP1 µV stream — the in-app version of
// tools/capture/precheck.py. PURE: no React, no BLE, no RN imports, so it's fully
// unit-testable. Drives the glowing ring on the Sleep-screen circle.
//
// Classification mirrors classify_epochs() in the Python analyzer (shared constants):
//   green  = good epoch   brain-band RMS in [3,150] µV, rail≤20%, hum≤15 µV
//   yellow = approaching  RMS >75 µV or hum >7.5 µV (within 2× of a limit)
//   orange = near limit   RMS >100 µV or hum >10 µV (within 1.5× of a limit)
//   red    = excluded     dead (<3 µV) / motion (>150 µV) / railed (>20%) / hum (>15 µV)
//
// The key change vs. the old ad-hoc ladder: a 1-45 Hz zero-phase bandpass is applied
// BEFORE measuring RMS so that slow DC drift (sub-1 Hz electrode polarisation) does
// not falsely redden the ring on a clean signal.

export type ContactBand = 'red' | 'orange' | 'yellow' | 'green';

export type ContactMetrics = {
  railFrac: number; // fraction of |µV| beyond the rail
  rmsUv: number; // brain-band (1–45 Hz) RMS (µV)
  humUv: number; // RMS at the mains line (µV) — measured on original signal
};

export type ContactThresholds = {
  railUv: number; // absolute |µV| value that counts as a rail sample
  railMaxFrac: number; // RAIL_FRAC: fraction of railed samples → red
  rmsDeadLow: number; // DEAD_RMS_UV: brain-band RMS below this → red (flat/dead)
  rmsRedHigh: number; // MOTION_RMS_UV: brain-band RMS above this → red (motion)
  rmsOrangeHigh: number; // rmsRedHigh / 1.5: above this → orange
  rmsYellowHigh: number; // rmsRedHigh / 2: above this → yellow
  humRedHigh: number; // HUM_ABS_UV: mains hum above this → red
  humOrangeHigh: number; // HUM_ABS_UV / 1.5: mains hum above this → orange
  humYellowHigh: number; // HUM_ABS_UV / 2: mains hum above this → yellow
};

// Shared constants that mirror classify_epochs() in tools/capture/precheck.py.
export const DEAD_RMS_UV = 3;
export const MOTION_RMS_UV = 150;
export const RAIL_FRAC = 0.20;
export const HUM_ABS_UV = 15;

export const DEFAULT_THRESHOLDS: ContactThresholds = {
  railUv: 100_000,
  railMaxFrac: RAIL_FRAC,
  rmsDeadLow: DEAD_RMS_UV,
  rmsRedHigh: MOTION_RMS_UV,
  rmsOrangeHigh: MOTION_RMS_UV / 1.5, // 100 µV
  rmsYellowHigh: MOTION_RMS_UV / 2,   // 75 µV
  humRedHigh: HUM_ABS_UV,
  humOrangeHigh: HUM_ABS_UV / 1.5,    // 10 µV
  humYellowHigh: HUM_ABS_UV / 2,      // 7.5 µV
};

/** Fraction of samples pinned beyond the rail (|µV| > railUv). 1.0 for no data. */
export function railFraction(uv: readonly number[], railUv: number): number {
  if (uv.length === 0) return 1;
  let c = 0;
  for (const v of uv) if (Math.abs(v) > railUv) c++;
  return c / uv.length;
}

/** RMS after removing a linear baseline — the real EEG amplitude, independent of
 *  any DC offset / slow drift. */
export function acRms(uv: readonly number[]): number {
  const n = uv.length;
  if (n < 2) return 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += uv[i];
    sxx += i * i;
    sxy += i * uv[i];
  }
  const denom = n * sxx - sx * sx;
  const a = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
  const b = (sy - a * sx) / n;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const r = uv[i] - (a * i + b);
    ss += r * r;
  }
  return Math.sqrt(ss / n);
}

/** RMS amplitude (µV) of the single tone at freqHz, via the Goertzel algorithm
 *  (one frequency bin — far cheaper than an FFT, fine to run live). */
export function goertzelRms(uv: readonly number[], fs: number, freqHz: number): number {
  const n = uv.length;
  if (n < 4 || freqHz <= 0 || freqHz >= fs / 2) return 0;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += uv[i];
  mean /= n;
  const k = Math.round((freqHz / fs) * n);
  const w = (2 * Math.PI * k) / n;
  const cw = Math.cos(w);
  const sw = Math.sin(w);
  const coeff = 2 * cw;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const s0 = uv[i] - mean + coeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  const real = s1 - s2 * cw;
  const imag = s2 * sw;
  const amp = (2 * Math.sqrt(real * real + imag * imag)) / n; // peak amplitude at the bin
  return amp / Math.SQRT2; // → RMS
}

// ── Zero-phase 1–45 Hz bandpass ───────────────────────────────────────────────
// Implemented as biquad high-pass (fc=1 Hz) + biquad low-pass (fc=45 Hz), applied
// forward then backward (filtfilt-style) to give zero phase shift.  The critical
// property is sub-1 Hz rejection: slow electrode drift is stripped before RMS is
// measured, preventing DC polarisation from falsely redding the ring.

interface BiquadCoeffs {
  b0: number; b1: number; b2: number;
  a1: number; a2: number;
}

/** Compute biquad high-pass coefficients (Butterworth 2nd-order). */
function hpCoeffs(fc: number, fs: number): BiquadCoeffs {
  const wc = Math.tan((Math.PI * fc) / fs); // bilinear pre-warped
  const k = 1 / (1 + Math.SQRT2 * wc + wc * wc);
  return {
    b0: k,
    b1: -2 * k,
    b2: k,
    a1: 2 * (wc * wc - 1) * k,
    a2: (1 - Math.SQRT2 * wc + wc * wc) * k,
  };
}

/** Compute biquad low-pass coefficients (Butterworth 2nd-order). */
function lpCoeffs(fc: number, fs: number): BiquadCoeffs {
  const wc = Math.tan((Math.PI * fc) / fs);
  const k = wc * wc / (1 + Math.SQRT2 * wc + wc * wc);
  return {
    b0: k,
    b1: 2 * k,
    b2: k,
    a1: 2 * (wc * wc - 1) / (1 + Math.SQRT2 * wc + wc * wc),
    a2: (1 - Math.SQRT2 * wc + wc * wc) / (1 + Math.SQRT2 * wc + wc * wc),
  };
}

/** Apply a single biquad filter in one direction; returns a new array.
 *  Initial conditions are set to DC steady-state at x[0] to suppress the
 *  transient ringing that would otherwise occur when the signal has a large
 *  DC offset (e.g. 8000 µV electrode polarisation). */
function biquadFilter(c: BiquadCoeffs, x: readonly number[]): number[] {
  const y = new Array<number>(x.length);
  if (x.length === 0) return y;
  // Steady-state DC init: for a DC input of x0 → y_ss = x0*(b0+b1+b2)/(1+a1+a2)
  const x0 = x[0];
  const dcGain = (1 + c.a1 + c.a2) !== 0
    ? (c.b0 + c.b1 + c.b2) / (1 + c.a1 + c.a2)
    : 0;
  const y0 = x0 * dcGain;
  let x1 = x0, x2 = x0, y1 = y0, y2 = y0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const yi = c.b0 * xi + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1; x1 = xi;
    y2 = y1; y1 = yi;
    y[i] = yi;
  }
  return y;
}

/** Apply a biquad filter zero-phase (forward + backward). */
function filtfiltBiquad(c: BiquadCoeffs, x: readonly number[]): number[] {
  const fwd = biquadFilter(c, x);
  const rev = biquadFilter(c, fwd.slice().reverse());
  return rev.reverse();
}

/**
 * Zero-phase 1–45 Hz bandpass.
 * Removes sub-1 Hz electrode drift (the chronic source of false red) while keeping
 * brain-band (delta 1 Hz → gamma 45 Hz) content intact.
 * @param uv  raw µV samples
 * @param fs  sample rate (Hz)
 * @returns   bandpassed µV samples (same length)
 */
export function bandpass1to45(uv: readonly number[], fs: number): number[] {
  if (uv.length < 4) return uv.slice();
  const hp = filtfiltBiquad(hpCoeffs(1, fs), uv);
  return filtfiltBiquad(lpCoeffs(45, fs), hp);
}

/** One-shot classification of a window of µV samples into a contact band.
 *
 * Mirrors classify_epochs() thresholds (DEAD_RMS_UV / MOTION_RMS_UV / RAIL_FRAC /
 * HUM_ABS_UV). The 1–45 Hz bandpass is applied before measuring RMS so that slow
 * DC drift does not falsely redden the ring.
 */
export function classifyContact(
  uv: readonly number[],
  fs: number,
  mainsHz: number,
  t: ContactThresholds = DEFAULT_THRESHOLDS,
): { band: ContactBand; metrics: ContactMetrics } {
  const railFrac = railFraction(uv, t.railUv);
  // Hum is measured on the original signal (mains frequency may be above 45 Hz LP).
  const humUv = goertzelRms(uv, fs, mainsHz);
  // Brain-band RMS: bandpass removes sub-1 Hz drift + above-45 Hz noise/artefacts.
  const band1to45 = bandpass1to45(uv, fs);
  const rmsUv = acRms(band1to45);
  let band: ContactBand;
  if (
    railFrac > t.railMaxFrac ||
    rmsUv < t.rmsDeadLow ||
    rmsUv > t.rmsRedHigh ||
    humUv > t.humRedHigh
  ) {
    band = 'red'; // excluded by classify_epochs
  } else if (rmsUv > t.rmsOrangeHigh || humUv > t.humOrangeHigh) {
    band = 'orange'; // approaching a limit
  } else if (rmsUv > t.rmsYellowHigh || humUv > t.humYellowHigh) {
    band = 'yellow';
  } else {
    band = 'green'; // good epoch
  }
  return { band, metrics: { railFrac, rmsUv, humUv } };
}

/** Stateful tracker: a rolling sample buffer + hysteresis so the ring doesn't
 *  flicker between bands. Push samples as they arrive; call update() ~3×/sec.
 *  A new band must hold for `hysteresisN` consecutive updates before it sticks. */
export class ContactQualityTracker {
  private buf: number[] = [];
  private readonly cap: number;
  private cur: ContactBand = 'red'; // pessimistic until we have good data
  private candidate: ContactBand = 'red';
  private streak = 0;
  private last: ContactMetrics = { railFrac: 1, rmsUv: 0, humUv: 0 };

  constructor(
    private readonly fs: number,
    private readonly mainsHz: number,
    windowSec = 3,
    private readonly hysteresisN = 3,
    private readonly t: ContactThresholds = DEFAULT_THRESHOLDS,
  ) {
    this.cap = Math.max(1, Math.round(fs * windowSec));
  }

  push(samples: readonly number[]): void {
    for (const s of samples) this.buf.push(s);
    const overflow = this.buf.length - this.cap;
    if (overflow > 0) this.buf.splice(0, overflow);
  }

  /** Recompute over the current window and apply hysteresis; returns the band
   *  actually shown. Holds the current band until ≥1 s of data is buffered. */
  update(): ContactBand {
    if (this.buf.length < Math.min(this.cap, Math.round(this.fs))) return this.cur;
    const { band, metrics } = classifyContact(this.buf, this.fs, this.mainsHz, this.t);
    this.last = metrics;
    if (band === this.cur) {
      this.candidate = band;
      this.streak = 0;
      return this.cur;
    }
    if (band === this.candidate) this.streak++;
    else {
      this.candidate = band;
      this.streak = 1;
    }
    if (this.streak >= this.hysteresisN) {
      this.cur = band;
      this.streak = 0;
    }
    return this.cur;
  }

  band(): ContactBand {
    return this.cur;
  }

  metrics(): ContactMetrics {
    return this.last;
  }

  reset(): void {
    this.buf = [];
    this.cur = 'red';
    this.candidate = 'red';
    this.streak = 0;
    this.last = { railFrac: 1, rmsUv: 0, humUv: 0 };
  }
}
