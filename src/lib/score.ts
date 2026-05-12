import type { Session, SleepStage } from './repos/types';

// Sleep Score 0..99, capped at 99 by design (the unreachable ceiling drives
// habit retention). Formula matches docs/superpowers/specs/2026-05-10-neurex-app-
// lean-mvp-design.md §7 in aleksaspetro/neurex-algorithms (Neurex_app branch).
//
// raw_score = 0.40 * sleep_efficiency_norm
//           + 0.25 * deep_sleep_norm
//           + 0.15 * rem_sleep_norm
//           + 0.10 * (1 - awakenings_penalty)
//           + 0.10 * stim_impact_norm
// sleep_score = min(99, round(raw_score * 100))

// Default age-expected minutes. Personalized per-user values can override
// later via a user profile fetch (score_config table in cloud schema).
const DEFAULT_DEEP_MIN = 90;
const DEFAULT_REM_MIN = 100;
// 6+ awakenings = full awakenings penalty.
const AWAKENINGS_PENALTY_FULL_AT = 6;
// 30%+ delta-power increase saturates the stim-impact bonus.
const STIM_IMPACT_SATURATION_PCT = 30;
// Hard ceiling — never 100 (psychological hook).
const SCORE_MAX = 99;

const WEIGHTS = {
  efficiency: 0.4,
  deep: 0.25,
  rem: 0.15,
  awakenings: 0.1,
  stimImpact: 0.1,
} as const;

export function computeScore(s: Session): number {
  const efficiencyNorm = clamp01(s.efficiency);

  const deepNorm = clamp01(s.stageMinutes.deep / DEFAULT_DEEP_MIN);
  const remNorm = clamp01(s.stageMinutes.rem / DEFAULT_REM_MIN);

  const awakeningsPenalty = clamp01(s.awakenings / AWAKENINGS_PENALTY_FULL_AT);

  // stimImpactPct is null until the staging pipeline has run for this night.
  // Treat null as "no bonus yet" — don't crash, don't punish.
  const stimImpactNorm =
    s.stimImpactPct == null
      ? 0
      : clamp01(s.stimImpactPct / STIM_IMPACT_SATURATION_PCT);

  const raw =
    WEIGHTS.efficiency * efficiencyNorm +
    WEIGHTS.deep * deepNorm +
    WEIGHTS.rem * remNorm +
    WEIGHTS.awakenings * (1 - awakeningsPenalty) +
    WEIGHTS.stimImpact * stimImpactNorm;

  return Math.min(SCORE_MAX, Math.round(raw * 100));
}

// Derive the awakenings count from a session's epochs:
// each contiguous run of wake epochs after sleep onset = one awakening.
// The trailing wake (morning waking up) is excluded — it's the user getting
// out of bed, not a sleep intrusion.
export function countAwakenings(epochs: Session['epochs']): number {
  const onsetIdx = epochs.findIndex((e) => e.stage !== 'wake');
  if (onsetIdx < 0) return 0;

  let count = 0;
  let inWake = false;
  for (let i = onsetIdx; i < epochs.length; i++) {
    if (epochs[i].stage === 'wake') {
      if (!inWake) {
        count++;
        inWake = true;
      }
    } else {
      inWake = false;
    }
  }
  const lastStage: SleepStage | undefined = epochs[epochs.length - 1]?.stage;
  if (lastStage === 'wake' && count > 0) count -= 1;
  return count;
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}
