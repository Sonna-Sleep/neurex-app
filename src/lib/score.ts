import type { Session } from './repos/types';

// Sleep score 0–100. Components: TST, efficiency, deep%, REM%, WASO.
// Numbers chosen so a healthy night (7.5h, 92% eff, 22% deep, 22% REM, 15min WASO) ≈ 88.
export function computeScore(s: Session): number {
  const tstHours = s.tst / 3600;
  const tstPts = clamp01((tstHours - 5) / 2.5) * 30; // 5h → 0, 7.5h → 30

  const effPts = clamp01((s.efficiency - 0.7) / 0.25) * 25; // 70% → 0, 95% → 25

  const deepFrac = (s.stageMinutes.deep * 60) / Math.max(s.tst, 1);
  const deepPts = clamp01(deepFrac / 0.22) * 20; // 22%+ → full

  const remFrac = (s.stageMinutes.rem * 60) / Math.max(s.tst, 1);
  const remPts = clamp01(remFrac / 0.22) * 20;

  const wasoPenalty = clamp01((s.waso / 60 - 30) / 60) * 5; // 30→90min → 0..5
  const wasoPts = 5 - wasoPenalty;

  return Math.round(tstPts + effPts + deepPts + remPts + wasoPts);
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, x));
}
