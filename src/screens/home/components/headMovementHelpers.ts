import type { HeadMovementEpoch, HeadMovementInsights, SleepStage } from '../../../lib/repos/types';

type GapRange = {
  startMs: number;
  endMs: number;
};

type StillestInsight = {
  durationMs: number;
  stage: SleepStage;
} | null;
type TiltDriftInsight = HeadMovementInsights['tiltDrift'];

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatDistance(ms: number) {
  const totalMinutes = Math.max(Math.floor(ms / 60_000), 0);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h`;
  return `${minutes}m`;
}

function formatStage(stage: SleepStage) {
  switch (stage) {
    case 'rem':
      return 'REM sleep';
    case 'light':
      return 'light sleep';
    case 'deep':
      return 'deep sleep';
    case 'wake':
      return 'wake';
    case 'excluded':
      return 'excluded';
  }
}

function formatDeg(value: number) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}` : `${rounded}`;
}

export function tiltToY(deg: number, laneTop: number, laneH: number, maxAbsDeg: number) {
  if (laneH <= 0) return laneTop;
  if (maxAbsDeg <= 0) return laneTop + laneH / 2;

  const clamped = clamp(deg, -maxAbsDeg, maxAbsDeg);
  const normalized = clamped / maxAbsDeg;
  return laneTop + laneH / 2 - normalized * (laneH / 2);
}

export function movementToH(movement: number, laneH: number) {
  return clamp(movement, 0, 1) * Math.max(laneH, 0);
}

export function rawTiltExtent(epochs: HeadMovementEpoch[]) {
  const values = epochs.flatMap((epoch) => [Math.abs(epoch.pitch), Math.abs(epoch.roll)]);
  return Math.max(1, ...values);
}

export function coverageGaps(epochs: HeadMovementEpoch[], startMs: number): GapRange[] {
  const gaps: GapRange[] = [];
  const epochMs = 30_000;

  for (const epoch of [...epochs].sort((a, b) => a.startMs - b.startMs)) {
    if (epoch.coverage !== 0) continue;

    const gapStart = startMs + epoch.startMs;
    const gapEnd = gapStart + epochMs;
    const lastGap = gaps[gaps.length - 1];

    if (lastGap && gapStart <= lastGap.endMs) {
      lastGap.endMs = Math.max(lastGap.endMs, gapEnd);
      continue;
    }

    gaps.push({ startMs: gapStart, endMs: gapEnd });
  }

  return gaps;
}

export function formatStillest(stillest: StillestInsight) {
  if (!stillest) return '';
  return `Most still during ${formatStage(stillest.stage)} - ${formatDistance(stillest.durationMs)}`;
}

export function formatDrift(drift: TiltDriftInsight) {
  if (!drift) return '';
  return `Roll drifted from ${formatDeg(drift.startRollDeg)}deg to ${formatDeg(drift.endRollDeg)}deg`;
}

export function formatShiftCount(shiftCount: number) {
  if (shiftCount <= 0) return '';
  return `${shiftCount} shift${shiftCount === 1 ? '' : 's'}`;
}
