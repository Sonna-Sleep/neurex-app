/**
 * Lull scientific core (TS port): drowsiness index W and sleep-onset detection.
 *
 * PURE: no I/O, no platform deps, no wall-clock. Every constant comes from the
 * params object (lull_params.json). This is a faithful port of the Phase-1
 * Python source of truth `tools/lull/sleepiness.py`. The golden-vector contract
 * (`__tests__/golden/lull_vectors.json`) is the acceptance gate.
 */

import {
  notch,
  bandpass,
  welchPsd,
  bandpower,
  sef,
  highpassRms,
} from './dsp';

// ---------------------------------------------------------------------------
// Params typing (mirrors lull_params.json).
// ---------------------------------------------------------------------------

export interface LullParams {
  fs_default: number;
  mains_hz: number;
  window_sec: number;
  update_sec: number;
  bandpass_hz: [number, number];
  welch_seg_sec: number;
  bands: { delta: [number, number]; theta: [number, number]; alpha: [number, number]; beta: [number, number] };
  sef_pct: number;
  sef_range_hz: [number, number];
  eog_fast_hz: number;
  eog_slow_band_hz: [number, number];
  feature_weights: { [k: string]: number };
  calib_seconds: number;
  calib_drop_mads: number;
  calib_rise_mads: number;
  calib_mad_floor: number;
  ema_tau_sec: number;
  onset: {
    w_threshold: number;
    dwell_sec: number;
    eog_slow_factor: number;
    alpha_dropout_frac: number;
    theta_rise_factor: number;
  };
  volume: {
    v_max: number;
    gamma: number;
    w_lo: number;
    w_hi: number;
    max_down_slew_per_sec: number;
    onset_fade_sec: number;
  };
  device_name_substr: string;
  filter_order: number;
  welch_min_samples: number;
  notch_q: number;
}

export interface Features {
  sef95: number;
  beta_rel: number;
  eog_fast: number;
  drowsy_ratio: number;
  eog_slow: number;
  alpha: number;
  theta: number;
}

// ---------------------------------------------------------------------------
// Feature extraction (mirrors extract_features).
// ---------------------------------------------------------------------------

export function extractFeatures(
  fp: number[],
  heog: number[],
  fs: number,
  params: LullParams
): Features {
  const bp = params.bandpass_hz;
  const seg = params.welch_seg_sec;
  const bands = params.bands;
  const order = params.filter_order;
  const minSamp = params.welch_min_samples;

  const fpN = notch(fp, fs, params.mains_hz, params.notch_q);
  const heogN = notch(heog, fs, params.mains_hz, params.notch_q);

  const eeg = bandpass(fpN, fs, bp[0], bp[1], order);
  const { f, pxx } = welchPsd(eeg, fs, seg, minSamp);
  const alpha = bandpower(f, pxx, bands.alpha[0], bands.alpha[1]);
  const theta = bandpower(f, pxx, bands.theta[0], bands.theta[1]);
  const beta = bandpower(f, pxx, bands.beta[0], bands.beta[1]);
  const total = bandpower(f, pxx, bp[0], bp[1]) || 1e-12;

  const sef95 = sef(f, pxx, params.sef_range_hz[0], params.sef_range_hz[1], params.sef_pct);
  const beta_rel = beta / total;
  const drowsy_ratio = theta / (alpha + beta + 1e-12);

  const eog_fast = highpassRms(heogN, fs, params.eog_fast_hz, order);
  // eog_slow uses the raw (notched) heog (not EEG bandpass): the SEM band
  // (0.2-0.6 Hz) lies below the EEG high-pass cutoff (0.5 Hz) and would be
  // erased if bandpassed first.
  const { f: fe, pxx: pe } = welchPsd(heogN, fs, seg, minSamp);
  const eog_slow = bandpower(fe, pe, params.eog_slow_band_hz[0], params.eog_slow_band_hz[1]);

  return {
    sef95,
    beta_rel,
    eog_fast,
    drowsy_ratio,
    eog_slow,
    alpha,
    theta,
  };
}

// ---------------------------------------------------------------------------
// Per-session calibration + alertness normalization.
// ---------------------------------------------------------------------------

/** Features whose HIGH values indicate alertness (they fall toward sleep). */
const ALERT_HIGH = ['sef95', 'beta_rel', 'eog_fast'] as const;

const clip01 = (x: number): number => Math.min(1.0, Math.max(0.0, x));

function medianOf(values: number[]): number {
  const a = values.slice().sort((x, y) => x - y);
  const n = a.length;
  if (n === 0) return 0;
  const mid = Math.floor(n / 2);
  return n % 2 === 1 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

function medianMad(values: number[], madFloor: number): [number, number] {
  const med = medianOf(values);
  const dev = values.map((v) => Math.abs(v - med));
  const mad = medianOf(dev) * 1.4826;
  return [med, Math.max(mad, madFloor)];
}

export class CalModel {
  private readonly stats: { [name: string]: [number, number] };
  private readonly drop: number;
  private readonly rise: number;
  readonly alphaAlert: number;
  readonly thetaAlert: number;
  readonly eogSlowAlert: number;

  constructor(stats: { [name: string]: [number, number] }, params: LullParams) {
    this.stats = stats;
    this.drop = params.calib_drop_mads;
    this.rise = params.calib_rise_mads;
    this.alphaAlert = stats.alpha[0];
    this.thetaAlert = stats.theta[0];
    this.eogSlowAlert = stats.eog_slow[0];
  }

  /** Normalize features into per-feature alertness scores in [0,1] (1=alert). */
  normalize(feats: Features): { [k: string]: number } {
    const out: { [k: string]: number } = {};
    for (const name of ALERT_HIGH) {
      const [med, mad] = this.stats[name];
      const lo = med - this.drop * mad; // estimated drowsy floor
      out[name] = clip01((feats[name] - lo) / (med - lo + 1e-12));
    }
    const [med, mad] = this.stats.drowsy_ratio;
    const hi = med + this.rise * mad; // estimated drowsy ceiling
    out.drowsy_ratio_inv = clip01((hi - feats.drowsy_ratio) / (hi - med + 1e-12));
    return out;
  }
}

export class Calibrator {
  private static readonly NAMES = [
    'sef95',
    'beta_rel',
    'eog_fast',
    'drowsy_ratio',
    'alpha',
    'theta',
    'eog_slow',
  ] as const;

  private readonly params: LullParams;
  private readonly buf: { [name: string]: number[] };
  count = 0;

  constructor(params: LullParams) {
    this.params = params;
    this.buf = {};
    for (const n of Calibrator.NAMES) this.buf[n] = [];
  }

  add(feats: Features): void {
    for (const n of Calibrator.NAMES) this.buf[n].push(feats[n]);
    this.count += 1;
  }

  finalize(): CalModel {
    if (this.count === 0) throw new Error('calibration requires at least one sample');
    const floor = this.params.calib_mad_floor;
    const stats: { [name: string]: [number, number] } = {};
    for (const n of Calibrator.NAMES) stats[n] = medianMad(this.buf[n], floor);
    return new CalModel(stats, this.params);
  }
}

// ---------------------------------------------------------------------------
// Sleepiness estimator: EMA-smoothed W + latched onset detector.
// ---------------------------------------------------------------------------

export interface EstimatorOutput {
  W: number;
  onset: boolean;
  calibrating: boolean;
  features: Features;
}

/**
 * Online estimator producing W ∈ [0,1] (1=alert) and a latched onset flag.
 * Timeline is driven exclusively by the `tSec` argument — never wall-clock.
 * During the first `calib_seconds` every call returns W=1.0, calibrating=true
 * and accumulates calibration data. On the first call at/after `calib_seconds`
 * the CalModel is finalized and live estimation begins.
 */
export class SleepinessEstimator {
  private readonly fs: number;
  private readonly p: LullParams;
  private readonly weights: { [k: string]: number };
  private readonly cal: Calibrator;
  private model: CalModel | null = null;
  private W = 1.0;
  private lastT: number | null = null;
  private dwell = 0.0;
  private onset = false; // latched; never resets

  constructor(fs: number, params: LullParams) {
    this.fs = fs;
    this.p = params;
    this.weights = params.feature_weights;
    this.cal = new Calibrator(params);
  }

  private wRaw(alertness: { [k: string]: number }): number {
    let s = 0;
    for (const k of Object.keys(this.weights)) s += this.weights[k] * alertness[k];
    return s;
  }

  private corroborated(feats: Features): boolean {
    const o = this.p.onset;
    const m = this.model!;
    // Criterion 1: slow eye movement elevated relative to alert baseline.
    const sem = feats.eog_slow > m.eogSlowAlert * o.eog_slow_factor;
    // Criterion 2: alpha dropout AND theta rise vs alert baselines.
    const dropout =
      feats.alpha < m.alphaAlert * o.alpha_dropout_frac &&
      feats.theta > m.thetaAlert * o.theta_rise_factor;
    return sem || dropout;
  }

  update(fp: number[], heog: number[], tSec: number): EstimatorOutput {
    const feats = extractFeatures(fp, heog, this.fs, this.p);

    // dt: use update_sec on the very first call, else the tSec delta.
    const dt =
      this.lastT === null
        ? this.p.update_sec
        : Math.max(tSec - this.lastT, 1e-3);
    this.lastT = tSec;

    // ---- Calibration phase ----
    if (tSec < this.p.calib_seconds) {
      this.cal.add(feats);
      return { W: 1.0, onset: false, calibrating: true, features: feats };
    }

    // ---- Finalize calibration on first post-calib call ----
    if (this.model === null) {
      this.cal.add(feats); // include this boundary window
      this.model = this.cal.finalize();
      this.W = 1.0;
    }

    // ---- Live estimation ----
    const alertness = this.model.normalize(feats);
    const wRawVal = this.wRaw(alertness);

    // EMA: α = 1 - exp(-dt / τ)
    const alphaEma = 1.0 - Math.exp(-dt / this.p.ema_tau_sec);
    this.W += alphaEma * (wRawVal - this.W);

    // ---- Onset state machine ----
    const o = this.p.onset;
    if (!this.onset) {
      if (this.W < o.w_threshold && this.corroborated(feats)) {
        this.dwell += dt;
      } else {
        this.dwell = 0.0;
      }
      if (this.dwell >= o.dwell_sec) {
        this.onset = true; // latch — never resets
      }
    }

    return { W: this.W, onset: this.onset, calibrating: false, features: feats };
  }
}
