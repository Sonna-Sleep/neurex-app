// Pre-bed signal-quality assessment, derived entirely from the existing EEG
// preview stream — no firmware/impedance support required. Feed it raw samples
// (µV) and packet sequence numbers; it produces a single plain-language verdict
// the Home screen shows before a user goes to sleep.
//
// Four silent checks roll up into one traffic light:
//   - contact:    electrode on skin & not railing (ADS1299 clip)
//   - stability:  baseline not drifting (the dry-electrode failure mode)
//   - signal:     real EEG amplitude present (not flatline, not motion artifact)
//   - connection: BLE packets arriving without gaps (phone close enough)
//
// `ready` only flips true once all four hold continuously for READY_MS, so a
// momentary good reading can't wave the user into bed on a marginal contact.

// ADS1299 clip rail at gain 24, ±4.5 V ref → ±187 mV. A sample at/above 95% of
// this means the electrode lifted and the amp railed.
export const RAIL_UV = (4.5 / 24) * 1e6;
const RAIL_FRAC = 0.95;

// Tuning. Derived from the same dry-electrode benches as the old preview;
// conservative on purpose — a wasted night is worse than a 10 s re-seat.
const RAIL_GOOD_PCT = 5; // <5% of recent samples railing = good contact
const DRIFT_GOOD_UV = 60; // baseline wander across the ~5 s history, peak-to-peak
const SIGNAL_MIN_UV = 3; // AC RMS below this = flatline / not on skin
const SIGNAL_MAX_UV = 250; // AC RMS above this = motion / artifact, not EEG
const DROP_GOOD_PCT = 5; // <5% packet loss = solid link
const READY_MS = 6000; // all-good must persist this long before "you're all set"

// Windowing.
const WINDOW_SAMPLES = 62; // ~250 ms at 250 Hz — one baseline/RMS data point
const HISTORY = 20; // keep ~5 s of windowed points
const RAIL_DECAY_AT = 1000; // halve rail counters past ~4 s so they track "recent"

export type Level = 'good' | 'warn';

export type SignalQuality = {
  contact: Level;
  stability: Level;
  signal: Level;
  connection: Level;
  allGood: boolean;
  /** allGood sustained for READY_MS — the only state that arms "sleep well". */
  ready: boolean;
  /** Single plain-language guidance line (the one most-actionable issue). */
  tip: string;
};

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export class SignalQualityTracker {
  // current ~250 ms window accumulators
  private winSum = 0;
  private winSumSq = 0;
  private winN = 0;
  // rolling per-window history (~5 s)
  private baselines: number[] = []; // window means → drift
  private rmsAc: number[] = []; // window AC-RMS → signal level
  // recent rail fraction
  private railCount = 0;
  private railTotal = 0;
  // link quality from packet seq gaps
  private prevSeq: number | null = null;
  private packets = 0;
  private drops = 0;
  // settling timer
  private goodSinceMs: number | null = null;

  pushSample(uV: number): void {
    this.railTotal += 1;
    if (Math.abs(uV) >= RAIL_UV * RAIL_FRAC) this.railCount += 1;
    if (this.railTotal >= RAIL_DECAY_AT) {
      this.railTotal = Math.round(this.railTotal / 2);
      this.railCount = Math.round(this.railCount / 2);
    }
    this.winSum += uV;
    this.winSumSq += uV * uV;
    this.winN += 1;
    if (this.winN >= WINDOW_SAMPLES) this.closeWindow();
  }

  private closeWindow(): void {
    const mean = this.winSum / this.winN;
    const variance = Math.max(0, this.winSumSq / this.winN - mean * mean);
    this.baselines.push(mean);
    this.rmsAc.push(Math.sqrt(variance)); // AC RMS = std-dev, baseline removed
    if (this.baselines.length > HISTORY) this.baselines.shift();
    if (this.rmsAc.length > HISTORY) this.rmsAc.shift();
    this.winSum = 0;
    this.winSumSq = 0;
    this.winN = 0;
  }

  pushSeq(seq: number): void {
    if (this.prevSeq !== null) {
      const gap = (seq - this.prevSeq - 1) & 0xff;
      this.drops += gap;
      this.packets += 1 + gap;
    } else {
      this.packets += 1;
    }
    this.prevSeq = seq;
    if (this.packets >= 256) {
      this.packets = Math.round(this.packets / 2);
      this.drops = Math.round(this.drops / 2);
    }
  }

  evaluate(nowMs: number): SignalQuality {
    // No data yet → everything reads "warn" (settling), never a false green.
    const railPct = this.railTotal > 0 ? (this.railCount / this.railTotal) * 100 : 100;
    const contact: Level = railPct < RAIL_GOOD_PCT ? 'good' : 'warn';

    const haveHistory = this.baselines.length >= HISTORY;
    const drift = haveHistory ? Math.max(...this.baselines) - Math.min(...this.baselines) : Infinity;
    const stability: Level = drift < DRIFT_GOOD_UV ? 'good' : 'warn';

    const sig = median(this.rmsAc);
    const signal: Level =
      this.rmsAc.length >= HISTORY && sig >= SIGNAL_MIN_UV && sig <= SIGNAL_MAX_UV ? 'good' : 'warn';

    const dropPct = this.packets > 0 ? (this.drops / this.packets) * 100 : 100;
    const connection: Level = dropPct < DROP_GOOD_PCT ? 'good' : 'warn';

    const allGood =
      contact === 'good' && stability === 'good' && signal === 'good' && connection === 'good';

    if (allGood) {
      if (this.goodSinceMs === null) this.goodSinceMs = nowMs;
    } else {
      this.goodSinceMs = null;
    }
    const ready = allGood && this.goodSinceMs !== null && nowMs - this.goodSinceMs >= READY_MS;

    return {
      contact,
      stability,
      signal,
      connection,
      allGood,
      ready,
      tip: pickTip({ contact, stability, signal, connection, allGood, sig }),
    };
  }
}

// One actionable line. Ordered by how the user fixes it: link first (move
// phone), then physical contact, then settling. Never a wall of problems.
function pickTip(s: {
  contact: Level;
  stability: Level;
  signal: Level;
  connection: Level;
  allGood: boolean;
  sig: number;
}): string {
  if (s.allGood) return "You're all set — sleep well";
  if (s.connection === 'warn') return 'Keep your phone on the nightstand, close to you';
  if (s.contact === 'warn') return 'Press the mask gently against your forehead';
  if (s.signal === 'warn' && s.sig < SIGNAL_MIN_UV) return 'Make sure the mask sits on bare skin';
  if (s.signal === 'warn') return 'Hold still for a few seconds';
  if (s.stability === 'warn') return 'Settling — hold still for a few seconds';
  return 'Checking your signal…';
}
