import type {
  Epoch,
  JournalTag,
  Session,
  SleepStage,
  StimPulse,
} from './repos/types';
import { computeScore, countAwakenings } from './score';

// Build a believable single-night session. 30s epochs, 4 NREM-REM cycles,
// deep sleep concentrated early, REM growing through the night.
export function seedMockSession(daysAgo = 0, quality = 1): Session {
  const EPOCH_SEC = 30;
  // Anchor wake at 07:05 on the target morning.
  const now = new Date();
  const wake = new Date(now);
  wake.setHours(7, 5, 0, 0);
  if (wake.getTime() > now.getTime()) wake.setDate(wake.getDate() - 1);
  wake.setDate(wake.getDate() - daysAgo);
  // TIB shrinks with lower quality (later bedtime).
  const tibMin = Math.round(455 * (0.78 + 0.22 * quality));
  const bed = new Date(wake.getTime() - tibMin * 60 * 1000);

  const startMs = bed.getTime();
  const endMs = wake.getTime();
  const tibSec = Math.round((endMs - startMs) / 1000);
  const totalEpochs = Math.floor(tibSec / EPOCH_SEC); // 910

  const stages: SleepStage[] = new Array(totalEpochs).fill('light');

  // Sleep onset: 12 min wake, then descend through light→deep
  const onsetEpochs = Math.floor((12 * 60) / EPOCH_SEC);
  for (let i = 0; i < onsetEpochs; i++) stages[i] = 'wake';

  // 4 cycles of ~110 min each, with the 5th tail being mostly REM/light.
  const q = Math.max(0.5, Math.min(1, quality));
  const cycles = [
    { len: 95, deep: Math.round(38 * q), rem: 8 },
    { len: 110, deep: Math.round(28 * q), rem: Math.round(18 * q) },
    { len: 110, deep: Math.round(12 * q), rem: Math.round(28 * q) },
    { len: 105, deep: Math.round(4 * q), rem: Math.round(32 * q) },
    { len: 70, deep: 0, rem: Math.round(22 * q) },
  ];

  let cursor = onsetEpochs;
  for (const c of cycles) {
    const cycleEpochs = Math.floor((c.len * 60) / EPOCH_SEC);
    const deepEpochs = Math.floor((c.deep * 60) / EPOCH_SEC);
    const remEpochs = Math.floor((c.rem * 60) / EPOCH_SEC);
    // Layout inside the cycle: light → deep (middle) → light → REM (end)
    const lightLead = Math.floor((cycleEpochs - deepEpochs - remEpochs) * 0.55);
    let p = cursor;
    for (let i = 0; i < lightLead && p < totalEpochs; i++) stages[p++] = 'light';
    for (let i = 0; i < deepEpochs && p < totalEpochs; i++) stages[p++] = 'deep';
    const lightTrail =
      cycleEpochs - lightLead - deepEpochs - remEpochs;
    for (let i = 0; i < lightTrail && p < totalEpochs; i++) stages[p++] = 'light';
    for (let i = 0; i < remEpochs && p < totalEpochs; i++) stages[p++] = 'rem';
    cursor += cycleEpochs;
  }
  // Sprinkle a handful of brief WASO awakenings
  const baseWaso = [180, 360, 540, 720];
  const extraWaso = quality < 0.8 ? [240, 420, 600, 780, 840] : [];
  const wasoAt = [...baseWaso, ...extraWaso];
  for (const idx of wasoAt) {
    if (idx < totalEpochs) {
      stages[idx] = 'wake';
      if (idx + 1 < totalEpochs) stages[idx + 1] = 'wake';
    }
  }

  const epochs: Epoch[] = stages.map((stage, i) => ({
    startMs: startMs + i * EPOCH_SEC * 1000,
    durationSec: EPOCH_SEC,
    stage,
  }));

  const stageMinutes: Record<SleepStage, number> = {
    wake: 0,
    rem: 0,
    light: 0,
    deep: 0,
  };
  for (const s of stages) stageMinutes[s] += EPOCH_SEC / 60;
  (Object.keys(stageMinutes) as SleepStage[]).forEach((k) => {
    stageMinutes[k] = Math.round(stageMinutes[k]);
  });

  const tstSec = (totalEpochs - stages.filter((s) => s === 'wake').length) * EPOCH_SEC;
  const wasoEpochs = stages
    .slice(onsetEpochs)
    .filter((s) => s === 'wake').length;
  const wasoSec = wasoEpochs * EPOCH_SEC;
  const efficiency = tstSec / tibSec;

  // Phase-locked stim pulses: only during the first two deep blocks.
  const stimPulses: StimPulse[] = [];
  let deepBlocksSeen = 0;
  let inDeep = false;
  for (let i = 0; i < stages.length; i++) {
    if (stages[i] === 'deep' && !inDeep) {
      inDeep = true;
      deepBlocksSeen++;
    } else if (stages[i] !== 'deep') {
      inDeep = false;
    }
    if (stages[i] === 'deep' && deepBlocksSeen <= 2) {
      // ~2 pulses per epoch, jittered
      for (let k = 0; k < 2; k++) {
        const t =
          startMs +
          i * EPOCH_SEC * 1000 +
          Math.floor(Math.random() * EPOCH_SEC * 1000);
        stimPulses.push({ tMs: t, epochIndex: i });
      }
    }
  }

  // Stim impact: better quality nights = stronger delta-band boost.
  // Real values come from the cloud staging pipeline (Modal + YASA + MNE).
  // For mock seed: scale linearly with quality, plus small jitter.
  const stimImpactPct = stimPulses.length
    ? Math.round((10 + 18 * q + (Math.random() * 6 - 3)) * 10) / 10
    : null;

  // Mock journal tags: alternate between common combos across nights so the
  // demo UI has variety. Index 0 (most recent) is empty so the user sees
  // what an un-tagged night looks like.
  const tagPalettes: JournalTag[][] = [
    [],
    ['caffeine'],
    ['exercise'],
    ['alcohol', 'late_meal'],
    ['stress'],
    ['exercise', 'caffeine'],
    ['alcohol'],
    ['traveled'],
    ['caffeine', 'late_meal'],
    [],
    ['stress', 'caffeine'],
    ['exercise'],
    ['sick'],
    ['alcohol', 'stress'],
  ];
  const journalTags = tagPalettes[daysAgo % tagPalettes.length] ?? [];

  const session: Session = {
    id: 'mock-' + wake.toISOString().slice(0, 10),
    startMs,
    endMs,
    tib: tibSec,
    tst: tstSec,
    waso: wasoSec,
    efficiency,
    awakenings: countAwakenings(epochs),
    stageMinutes,
    epochs,
    stimPulses,
    stimImpactPct,
    journalTags,
    score: null,
  };
  session.score = computeScore(session);
  return session;
}
