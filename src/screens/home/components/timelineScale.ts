import type { Epoch, HeadMovementEpoch } from '../../../lib/repos';

export const LABEL_W = 36; // left gutter reserved for lane labels
const HEAD_MOVEMENT_EPOCH_MS = 30_000;

export function stagedEndMs(
  epochs: Epoch[],
  startMs: number,
  fallbackEndMs: number,
) {
  if (!epochs.length) return fallbackEndMs;
  const lastOffsetMs = epochs.reduce(
    (max, e) => Math.max(max, e.startMs + e.durationSec * 1000),
    0,
  );
  return lastOffsetMs > 0 ? startMs + lastOffsetMs : fallbackEndMs;
}

export function makeXAt(
  startMs: number,
  chartEndMs: number,
  width: number,
) {
  const totalMs = Math.max(chartEndMs - startMs, 1);
  const chartLeft = LABEL_W;
  const chartW = Math.max(width - LABEL_W, 1);
  return (ms: number) => chartLeft + ((ms - startMs) / totalMs) * chartW;
}

export function headMovementChartEndMs(
  epochs: HeadMovementEpoch[],
  startMs: number,
  fallbackEndMs: number,
) {
  if (!epochs.length) return fallbackEndMs;
  const lastOffsetMs = epochs.reduce(
    (max, epoch) => Math.max(max, epoch.startMs + HEAD_MOVEMENT_EPOCH_MS),
    0,
  );
  return lastOffsetMs > 0 ? startMs + lastOffsetMs : fallbackEndMs;
}

export function axisTicks(startMs: number, endMs: number) {
  const ticks: { ms: number; label: string }[] = [];
  const start = new Date(startMs);
  const first = new Date(start);
  first.setMinutes(0, 0, 0);
  if (first.getHours() % 2 !== 0) first.setHours(first.getHours() + 1);
  if (first.getTime() < startMs) first.setHours(first.getHours() + 2);
  for (let t = first.getTime(); t <= endMs; t += 2 * 3600 * 1000) {
    const d = new Date(t);
    const h12 = ((d.getHours() + 11) % 12) + 1;
    const ampm = d.getHours() < 12 ? 'AM' : 'PM';
    ticks.push({ ms: t, label: `${h12} ${ampm}` });
  }
  return ticks;
}
