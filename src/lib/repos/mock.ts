import type {
  Device,
  DeviceRepo,
  Epoch,
  Session,
  SessionRepo,
  SleepStage,
  StimPulse,
} from './types';

/**
 * TEMPORARY demo data — a stand-in for the cloud.
 *
 * The app is a pure receive-and-display layer; it never derives sleep metrics.
 * Each night below is hand-authored as a stage timeline. `buildNight` only
 * reshapes that authored data into the `Session` shape the cloud will send —
 * expand the timeline into epochs, place it on the calendar, sum the stage
 * totals. No sleep-science simulation lives here.
 *
 * Delete this file when the real cloud-backed SessionRepo lands, and point
 * repos/index.ts at that instead.
 */

const EPOCH_SEC = 30;

// Reusable night "shapes" — a stage timeline as [stage, minutes] segments,
// in order from lights-out to wake-up.
const TIMELINES: Record<string, [SleepStage, number][]> = {
  solid: [
    ['wake', 12], ['light', 36], ['deep', 40], ['light', 30], ['rem', 14],
    ['light', 40], ['deep', 32], ['light', 32], ['rem', 24],
    ['light', 36], ['deep', 18], ['light', 34], ['rem', 28],
    ['light', 28], ['rem', 22], ['wake', 6],
  ],
  decent: [
    ['wake', 16], ['light', 40], ['deep', 32], ['light', 34], ['rem', 14],
    ['light', 42], ['deep', 24], ['light', 36], ['rem', 22],
    ['light', 38], ['deep', 14], ['light', 32], ['rem', 24], ['wake', 8],
  ],
  rough: [
    ['wake', 26], ['light', 44], ['deep', 22], ['light', 28], ['wake', 10],
    ['light', 40], ['deep', 16], ['rem', 16], ['wake', 8],
    ['light', 44], ['deep', 10], ['light', 32], ['rem', 20], ['wake', 12],
    ['light', 28], ['rem', 16],
  ],
  short: [
    ['wake', 14], ['light', 36], ['deep', 34], ['light', 30], ['rem', 16],
    ['light', 38], ['deep', 22], ['light', 28], ['rem', 24],
    ['light', 26], ['rem', 18], ['wake', 6],
  ],
};

type MockNight = {
  daysAgo: number;
  score: number;
  stimCount: number;
  stimImpactPct: number | null;
  shape: keyof typeof TIMELINES;
};

// 14 authored nights. Index 0 is the most recent.
const NIGHTS: MockNight[] = [
  { daysAgo: 0, score: 88, stimCount: 264, stimImpactPct: 27, shape: 'solid' },
  { daysAgo: 1, score: 91, stimCount: 281, stimImpactPct: 31, shape: 'solid' },
  { daysAgo: 2, score: 79, stimCount: 212, stimImpactPct: 18, shape: 'decent' },
  { daysAgo: 3, score: 68, stimCount: 174, stimImpactPct: 12, shape: 'rough' },
  { daysAgo: 4, score: 84, stimCount: 240, stimImpactPct: 23, shape: 'decent' },
  { daysAgo: 5, score: 90, stimCount: 276, stimImpactPct: 29, shape: 'solid' },
  { daysAgo: 6, score: 62, stimCount: 151, stimImpactPct: 9, shape: 'rough' },
  { daysAgo: 7, score: 86, stimCount: 252, stimImpactPct: 25, shape: 'decent' },
  { daysAgo: 8, score: 81, stimCount: 228, stimImpactPct: 20, shape: 'short' },
  { daysAgo: 9, score: 93, stimCount: 288, stimImpactPct: 33, shape: 'solid' },
  { daysAgo: 10, score: 71, stimCount: 188, stimImpactPct: 14, shape: 'rough' },
  { daysAgo: 11, score: 85, stimCount: 246, stimImpactPct: 24, shape: 'decent' },
  { daysAgo: 12, score: 89, stimCount: 268, stimImpactPct: 28, shape: 'solid' },
  { daysAgo: 13, score: 74, stimCount: 196, stimImpactPct: 16, shape: 'short' },
];

// Mechanically reshape one authored night into a Session. No metrics are
// invented here — everything is summed or expanded from the authored timeline.
function buildNight(n: MockNight): Session {
  const timeline = TIMELINES[n.shape];
  const tibMin = timeline.reduce((sum, [, min]) => sum + min, 0);
  const tibSec = tibMin * 60;

  // Place the night on the calendar: ends at ~07:00, `daysAgo` days back.
  const wake = new Date();
  wake.setHours(7, 0, 0, 0);
  if (wake.getTime() > Date.now()) wake.setDate(wake.getDate() - 1);
  wake.setDate(wake.getDate() - n.daysAgo);
  const endMs = wake.getTime();
  const startMs = endMs - tibSec * 1000;

  // Expand the timeline into per-epoch entries.
  const epochs: Epoch[] = [];
  let t = startMs;
  for (const [stage, minutes] of timeline) {
    const count = (minutes * 60) / EPOCH_SEC;
    for (let i = 0; i < count; i++) {
      epochs.push({ startMs: t, durationSec: EPOCH_SEC, stage });
      t += EPOCH_SEC * 1000;
    }
  }

  // Sum stage totals from the timeline.
  const stageMinutes: Record<SleepStage, number> = {
    wake: 0,
    light: 0,
    rem: 0,
    deep: 0,
  };
  for (const [stage, minutes] of timeline) stageMinutes[stage] += minutes;

  // The leading segment is sleep-onset wake; the rest of the wake is WASO.
  const onsetMin = timeline[0][0] === 'wake' ? timeline[0][1] : 0;
  const tstSec = (tibMin - stageMinutes.wake) * 60;
  const wasoSec = (stageMinutes.wake - onsetMin) * 60;
  const awakenings = timeline.filter(
    ([stage], i) => stage === 'wake' && i !== 0,
  ).length;

  // Stim pulses spread evenly across the night — only the count is read by UI.
  const stimPulses: StimPulse[] = Array.from(
    { length: n.stimCount },
    (_, i) => ({
      tMs: startMs + Math.floor(((i + 1) / (n.stimCount + 1)) * tibSec) * 1000,
      epochIndex: i,
    }),
  );

  return {
    id: `mock-${n.daysAgo}`,
    startMs,
    endMs,
    tib: tibSec,
    tst: tstSec,
    waso: wasoSec,
    efficiency: tstSec / tibSec,
    awakenings,
    stageMinutes,
    epochs,
    stimPulses,
    stimImpactPct: n.stimImpactPct,
    score: n.score,
  };
}

class MockSessionRepo implements SessionRepo {
  private nights: Session[] = NIGHTS.map(buildNight);

  async list(): Promise<Session[]> {
    return this.nights;
  }

  async latest(): Promise<Session | null> {
    return this.nights[0] ?? null;
  }

  async byId(id: string): Promise<Session | null> {
    return this.nights.find((s) => s.id === id) ?? null;
  }
}

class MockDeviceRepo implements DeviceRepo {
  private device: Device | null = {
    serial: 'NRX-DEMO-0001',
    battery: 78,
    firmware: '1.0.0',
    lastSyncMs: Date.now() - 6 * 3600 * 1000,
    paired: true,
  };

  async current(): Promise<Device | null> {
    return this.device;
  }

  async unpair(): Promise<void> {
    this.device = null;
  }

  pair(serial: string) {
    this.device = {
      serial,
      battery: 87,
      firmware: '1.0.0',
      lastSyncMs: null,
      paired: true,
    };
  }
}

export const mockSessionRepo = new MockSessionRepo();
export const mockDeviceRepo = new MockDeviceRepo();
