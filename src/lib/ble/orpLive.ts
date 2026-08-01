import type { ParsedPacket } from './types';

export const ORP_WINDOW_SECONDS = 3;
export const ORP_SMOOTH_MINUTES = 5;
export const ORP_BASELINE_MINUTES = 30;
export const ORP_MIN_CALIBRATION_WINDOWS = 10;
export const ORP_ARTIFACT_P99_UV = 250;
export const ORP_ARTIFACT_MAX_UV = 500;

const BANDS = [
  [0.33, 2.33],
  [2.33, 6.67],
  [6.67, 14],
  [14, 35],
] as const;

type BandVector = [number, number, number, number];
type EpochRow = {
  deviceMs: number;
  score: number | null;
  smooth: number | null;
  instantaneousConfidence: number;
  validChannels: number;
};

export type OrpLiveSnapshot = {
  deviceMs: number;
  rawScore: number | null;
  smoothedScore: number | null;
  confidence: number;
  artifactBurden: number;
  validChannels: number;
  channelScores: { Fp1: number | null; Fp2: number | null };
  baselineP60: number | null;
  slopePerMinute: number | null;
  sustainedSlopePerMinute: number | null;
  calibrationWindows: number;
};

class Biquad {
  private z1 = 0;
  private z2 = 0;
  constructor(
    private readonly b0: number,
    private readonly b1: number,
    private readonly b2: number,
    private readonly a1: number,
    private readonly a2: number,
  ) {}

  push(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }

  reset(): void {
    this.z1 = 0;
    this.z2 = 0;
  }
}

function lowpass(fs: number, hz: number): Biquad {
  const w = (2 * Math.PI * hz) / fs;
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const c = Math.cos(w);
  const a0 = 1 + alpha;
  return new Biquad(
    ((1 - c) / 2) / a0,
    (1 - c) / a0,
    ((1 - c) / 2) / a0,
    (-2 * c) / a0,
    (1 - alpha) / a0,
  );
}

function highpass(fs: number, hz: number): Biquad {
  const w = (2 * Math.PI * hz) / fs;
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
  const c = Math.cos(w);
  const a0 = 1 + alpha;
  return new Biquad(
    ((1 + c) / 2) / a0,
    (-(1 + c)) / a0,
    ((1 + c) / 2) / a0,
    (-2 * c) / a0,
    (1 - alpha) / a0,
  );
}

function percentile(values: number[], pct: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * pct;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function median(values: number[]): number | null {
  return percentile(values, 0.5);
}

function rankAgainstHistory(value: number, history: number[]): number | null {
  if (history.length < ORP_MIN_CALIBRATION_WINDOWS) return null;
  let rank = 0;
  for (let d = 1; d <= 9; d++) {
    const edge = percentile(history, d / 10);
    if (edge !== null && value >= edge) rank++;
  }
  return rank;
}

function linearSlopePerMinute(rows: EpochRow[], minutes: number): number | null {
  if (rows.length < 2) return null;
  const end = rows[rows.length - 1].deviceMs;
  const start = end - minutes * 60_000;
  const points = rows.filter((r) => r.deviceMs >= start && r.smooth !== null);
  if (points.length < 2) return null;
  const x0 = points[0].deviceMs;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const point of points) {
    const x = (point.deviceMs - x0) / 60_000;
    const y = point.smooth as number;
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const n = points.length;
  const denominator = n * sxx - sx * sx;
  return denominator === 0 ? null : (n * sxy - sx * sy) / denominator;
}

class ChannelProcessor {
  private readonly hp: Biquad;
  private readonly lp: Biquad;
  private readonly samples: number[] = [];
  private readonly history: [number[], number[], number[], number[]] = [[], [], [], []];

  constructor(private readonly fs: number, private readonly windowSamples: number) {
    this.hp = highpass(fs, 0.3);
    this.lp = lowpass(fs, Math.min(35, fs / 2 - 1));
  }

  push(value: number): void {
    this.samples.push(Number.isFinite(value) ? this.lp.push(this.hp.push(value)) : Number.NaN);
  }

  resetPartial(): void {
    this.samples.length = 0;
    this.hp.reset();
    this.lp.reset();
  }

  ready(): boolean {
    return this.samples.length >= this.windowSamples;
  }

  takeEpoch(): { valid: boolean; score: number | null; calibration: number } {
    const values = this.samples.splice(0, this.windowSamples);
    if (values.some((x) => !Number.isFinite(x))) {
      return { valid: false, score: null, calibration: this.history[0].length };
    }
    const center = median(values);
    if (center === null) return { valid: false, score: null, calibration: this.history[0].length };
    const abs = values.map((x) => Math.abs(x - center));
    const p99 = percentile(abs, 0.99) ?? Number.POSITIVE_INFINITY;
    const max = Math.max(...abs);
    if (p99 > ORP_ARTIFACT_P99_UV || max > ORP_ARTIFACT_MAX_UV) {
      return { valid: false, score: null, calibration: this.history[0].length };
    }

    const powers = spectralBandPowers(values, this.fs);
    const logP = powers.map((x) => Math.log10(Math.max(x, 1e-18))) as BandVector;
    const ranks = logP.map((x, i) => rankAgainstHistory(x, this.history[i])) as (
      | number
      | null
    )[];
    for (let i = 0; i < 4; i++) {
      this.history[i].push(logP[i]);
      const maxHistory = Math.round((ORP_BASELINE_MINUTES * 60) / ORP_WINDOW_SECONDS);
      if (this.history[i].length > maxHistory) this.history[i].shift();
    }
    if (ranks.some((x) => x === null)) {
      return { valid: true, score: null, calibration: this.history[0].length };
    }
    const [slow, mid, alpha, beta] = ranks as number[];
    const raw = 0.25 * mid + 0.35 * alpha + 0.55 * beta - 0.45 * slow;
    const score = Math.min(2.5, Math.max(0, (2.5 * (raw - -4.05)) / (10.35 - -4.05)));
    return { valid: true, score, calibration: this.history[0].length };
  }
}

/** Single Hann periodogram with the same 1/3-Hz bin spacing as the reference
 * when fs=250 and N=750. Direct DFT is used only through 35 Hz, keeping the
 * live work bounded and avoiding an FFT/native dependency in the BLE path.
 */
export function spectralBandPowers(samples: number[], fs: number): BandVector {
  const n = samples.length;
  const mean = samples.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const maxK = Math.min(Math.floor((35 * n) / fs), Math.floor(n / 2));
  const bins = new Array<number>(maxK + 1).fill(0);
  let windowEnergy = 0;
  const windowed = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const w = n > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)) : 1;
    windowed[i] = (samples[i] - mean) * w;
    windowEnergy += w * w;
  }
  for (let k = 1; k <= maxK; k++) {
    const theta = (-2 * Math.PI * k) / n;
    const cs = Math.cos(theta);
    const sn = Math.sin(theta);
    let c = 1;
    let s = 0;
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      re += windowed[i] * c;
      im += windowed[i] * s;
      const nextC = c * cs - s * sn;
      s = s * cs + c * sn;
      c = nextC;
    }
    bins[k] = (2 * (re * re + im * im)) / (fs * Math.max(windowEnergy, 1e-18));
  }
  const df = fs / n;
  return BANDS.map(([lo, hi]) => {
    const selected: number[] = [];
    for (let k = 1; k <= maxK; k++) {
      const f = k * df;
      if (f >= lo && f < hi) selected.push(bins[k]);
    }
    if (selected.length < 2) return 0;
    let area = 0;
    for (let i = 1; i < selected.length; i++) area += ((selected[i - 1] + selected[i]) / 2) * df;
    return area;
  }) as BandVector;
}

export class LiveOrpProcessor {
  private readonly channels: { Fp1: ChannelProcessor; Fp2: ChannelProcessor };
  private readonly rows: EpochRow[] = [];
  private lastSampleMs: number | null = null;
  private readonly sampleIntervalMs: number;
  private epochDeviceMs = 0;

  constructor(readonly sampleRateHz: number = 250) {
    const windowSamples = Math.round(sampleRateHz * ORP_WINDOW_SECONDS);
    this.sampleIntervalMs = 1000 / sampleRateHz;
    this.channels = {
      Fp1: new ChannelProcessor(sampleRateHz, windowSamples),
      Fp2: new ChannelProcessor(sampleRateHz, windowSamples),
    };
  }

  resetPartial(): void {
    this.channels.Fp1.resetPartial();
    this.channels.Fp2.resetPartial();
    this.lastSampleMs = null;
  }

  feedPacket(packet: ParsedPacket): OrpLiveSnapshot[] {
    const out: OrpLiveSnapshot[] = [];
    for (const sample of packet.samples) {
      if (this.lastSampleMs !== null) {
        const delta = (sample.ms - this.lastSampleMs) >>> 0;
        if (Math.abs(delta - this.sampleIntervalMs) > 0.5) this.resetPartial();
      }
      this.lastSampleMs = sample.ms;
      this.epochDeviceMs = sample.ms;
      this.channels.Fp1.push(sample.channels.Fp1 ?? Number.NaN);
      this.channels.Fp2.push(sample.channels.Fp2 ?? Number.NaN);
      if (this.channels.Fp1.ready() && this.channels.Fp2.ready()) out.push(this.finishEpoch());
    }
    return out;
  }

  private finishEpoch(): OrpLiveSnapshot {
    const fp1 = this.channels.Fp1.takeEpoch();
    const fp2 = this.channels.Fp2.takeEpoch();
    const scores = [fp1.score, fp2.score].filter((x): x is number => x !== null);
    const rawScore = median(scores);
    const validChannels = Number(fp1.valid) + Number(fp2.valid);
    let agreement = 0;
    if (rawScore !== null && scores.length > 0) {
      agreement = median(scores.map((x) => Math.abs(x - rawScore))) ?? 0;
    }
    const instantaneousConfidence =
      rawScore === null ? 0 : Math.min(1, Math.max(0, (validChannels / 2) * (1 - agreement / 1.25)));

    const smoothingCount = Math.round((ORP_SMOOTH_MINUTES * 60) / ORP_WINDOW_SECONDS);
    const priorScores = this.rows.slice(-(smoothingCount - 1)).flatMap((r) =>
      r.score === null ? [] : [r.score],
    );
    const smoothingValues = rawScore === null ? priorScores : [...priorScores, rawScore];
    const smooth = smoothingValues.length
      ? smoothingValues.reduce((a, b) => a + b, 0) / smoothingValues.length
      : null;
    const baselineValues = this.rows.slice(-600).flatMap((r) =>
      r.smooth === null ? [] : [r.smooth],
    );
    const baselineP60 = percentile(baselineValues, 0.6);

    this.rows.push({
      deviceMs: this.epochDeviceMs,
      score: rawScore,
      smooth,
      instantaneousConfidence,
      validChannels,
    });
    if (this.rows.length > 600) this.rows.shift();

    const recent = this.rows.slice(-smoothingCount);
    const invalidChannelWindows = recent.reduce((sum, row) => sum + (2 - row.validChannels), 0);
    const artifactBurden = recent.length ? invalidChannelWindows / (recent.length * 2) : 1;
    const recentConfidence = recent.length
      ? recent.reduce((sum, row) => sum + row.instantaneousConfidence, 0) / recent.length
      : 0;
    const confidence = Math.min(1, Math.max(0, recentConfidence * (1 - artifactBurden)));

    return {
      deviceMs: this.epochDeviceMs,
      rawScore,
      smoothedScore: smooth,
      confidence,
      artifactBurden,
      validChannels,
      channelScores: { Fp1: fp1.score, Fp2: fp2.score },
      baselineP60,
      slopePerMinute: linearSlopePerMinute(this.rows, 5),
      sustainedSlopePerMinute: linearSlopePerMinute(this.rows, 2),
      calibrationWindows: Math.min(fp1.calibration, fp2.calibration),
    };
  }
}
