// Live electrode-contact quality from the FP1 µV stream — the in-app version of
// tools/capture/precheck.py. PURE: no React, no BLE, no RN imports, so it's fully
// unit-testable. Drives the glowing ring on the Sleep-screen circle.
//
// Worst-dimension-wins over a rolling window:
//   green  = good        no railing, RMS ~5–80 µV, low mains hum
//   yellow = usable      RMS 80–120 µV or moderate hum
//   orange = not enough  RMS 120–300 µV or high hum
//   red    = bad         railed / flat / no contact / RMS >300 µV

export type ContactBand = 'red' | 'orange' | 'yellow' | 'green';

export type ContactMetrics = {
  railFrac: number; // fraction of |µV| beyond the rail
  rmsUv: number; // detrended AC RMS (µV)
  humUv: number; // RMS at the mains line (µV)
};

export type ContactThresholds = {
  railUv: number;
  railMaxFrac: number;
  rmsDeadLow: number; // below this = flat/dead → red
  rmsRedHigh: number; // above this = red
  rmsOrangeHigh: number; // above this = orange
  rmsYellowHigh: number; // above this = yellow
  humOrange: number; // mains RMS above this = orange
  humYellow: number; // mains RMS above this = yellow
};

export const DEFAULT_THRESHOLDS: ContactThresholds = {
  railUv: 100_000,
  railMaxFrac: 0.01,
  rmsDeadLow: 0.5,
  rmsRedHigh: 300,
  rmsOrangeHigh: 120,
  rmsYellowHigh: 80,
  humOrange: 40,
  humYellow: 20,
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

/** One-shot classification of a window of µV samples into a contact band. */
export function classifyContact(
  uv: readonly number[],
  fs: number,
  mainsHz: number,
  t: ContactThresholds = DEFAULT_THRESHOLDS,
): { band: ContactBand; metrics: ContactMetrics } {
  const railFrac = railFraction(uv, t.railUv);
  const rmsUv = acRms(uv);
  const humUv = goertzelRms(uv, fs, mainsHz);
  let band: ContactBand;
  if (railFrac > t.railMaxFrac || rmsUv > t.rmsRedHigh || rmsUv < t.rmsDeadLow) {
    band = 'red';
  } else if (rmsUv > t.rmsOrangeHigh || humUv > t.humOrange) {
    band = 'orange';
  } else if (rmsUv > t.rmsYellowHigh || humUv > t.humYellow) {
    band = 'yellow';
  } else {
    band = 'green';
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
