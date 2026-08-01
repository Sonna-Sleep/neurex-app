import type {
  InsightPoint,
  PositionSegment,
  SleepInsights,
  SleepPosition,
} from './types';

const POSITIONS: SleepPosition[] = ['left', 'right', 'back', 'stomach', 'unknown'];

function record(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function nonNegative(value: unknown): number | undefined {
  const n = finite(value);
  return n != null && n >= 0 ? n : undefined;
}

function points(value: unknown): InsightPoint[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed = value
    .map((item) => {
      const row = record(item);
      const offsetSec = nonNegative(row?.offsetSec);
      const pointValue = finite(row?.value);
      return offsetSec == null || pointValue == null ? null : { offsetSec, value: pointValue };
    })
    .filter((item): item is InsightPoint => item != null)
    .sort((a, b) => a.offsetSec - b.offsetSec);
  return parsed.length ? parsed : undefined;
}

function positions(value: unknown): PositionSegment[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const parsed = value
    .map((item) => {
      const row = record(item);
      const startSec = nonNegative(row?.startSec);
      const durationSec = nonNegative(row?.durationSec);
      const position = row?.position;
      if (
        startSec == null ||
        durationSec == null ||
        typeof position !== 'string' ||
        !POSITIONS.includes(position as SleepPosition)
      ) {
        return null;
      }
      const quality = finite(row?.quality);
      return {
        startSec,
        durationSec,
        position: position as SleepPosition,
        ...(quality != null ? { quality: Math.max(0, Math.min(100, quality)) } : {}),
      };
    })
    .filter((item): item is PositionSegment => item != null)
    .sort((a, b) => a.startSec - b.startSec);
  return parsed.length ? parsed : undefined;
}

/**
 * Treats cloud JSON as untrusted input. A partially populated object is valid;
 * malformed readings are dropped instead of crashing the night report.
 */
export function normalizeSleepInsights(value: unknown): SleepInsights | null {
  const root = record(value);
  if (!root) return null;
  const schemaVersion = nonNegative(root.schemaVersion) ?? 1;

  const motionRow = record(root.motion);
  const motionEvents = Array.isArray(motionRow?.events)
    ? motionRow.events
        .map((item) => {
          const row = record(item);
          const offsetSec = nonNegative(row?.offsetSec);
          const intensity = nonNegative(row?.intensity);
          return offsetSec == null || intensity == null ? null : { offsetSec, intensity };
        })
        .filter((item): item is { offsetSec: number; intensity: number } => item != null)
        .sort((a, b) => a.offsetSec - b.offsetSec)
    : undefined;
  const motion = motionRow
    ? {
        turns: nonNegative(motionRow.turns),
        restlessMinutes: nonNegative(motionRow.restlessMinutes),
        events: motionEvents?.length ? motionEvents : undefined,
        positions: positions(motionRow.positions),
      }
    : undefined;

  const cardioRow = record(root.cardio);
  const metric = (value: unknown, includeRange: boolean) => {
    const row = record(value);
    if (!row) return undefined;
    return {
      average: finite(row.average),
      ...(includeRange ? { min: finite(row.min), max: finite(row.max) } : {}),
      series: points(row.series),
    };
  };
  const cardio = cardioRow
    ? {
        heartRateBpm: metric(cardioRow.heartRateBpm, true),
        hrvRmssdMs: metric(cardioRow.hrvRmssdMs, false),
        respirationRate: metric(cardioRow.respirationRate, true),
      }
    : undefined;

  const eyeRow = record(root.eyeMovements);
  const eyeMovements = eyeRow
    ? {
        events: nonNegative(eyeRow.events),
        eventsPerHour: nonNegative(eyeRow.eventsPerHour),
        remDensity: nonNegative(eyeRow.remDensity),
        series: points(eyeRow.series),
      }
    : undefined;

  const soundRow = record(root.sound);
  const sound = soundRow
    ? {
        snoringMinutes: nonNegative(soundRow.snoringMinutes),
        snoringEpisodes: nonNegative(soundRow.snoringEpisodes),
        possibleBreathingDisturbances: nonNegative(soundRow.possibleBreathingDisturbances),
        series: points(soundRow.series),
      }
    : undefined;

  return { schemaVersion, motion, cardio, eyeMovements, sound };
}
