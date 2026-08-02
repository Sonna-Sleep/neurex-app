import type {
  InsightMetric,
  InsightPoint,
  InsightSensor,
  PositionSegment,
  SleepInsights,
  SleepPosition,
} from './types';

const POSITIONS: SleepPosition[] = ['left', 'right', 'back', 'stomach', 'unknown'];
const SENSORS: InsightSensor[] = ['eeg', 'eog', 'imu', 'ppg', 'audio', 'environment'];
const CHRONOTYPES = ['early', 'intermediate', 'late'] as const;
const WINDOW_KINDS = ['morningLight', 'exercise', 'lastMeal', 'screensOff'] as const;
const INTERVENTION_KINDS = ['pinkNoise', 'windDownAudio', 'wakeLight', 'other'] as const;

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

function text(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const cleaned = value.trim();
  return cleaned ? cleaned.slice(0, 120) : undefined;
}

function boundedPercent(value: unknown): number | undefined {
  const n = finite(value);
  return n == null ? undefined : Math.max(0, Math.min(100, n));
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

function metric(value: unknown, includeRange = true): InsightMetric | undefined {
  const row = record(value);
  if (!row) return undefined;
  return {
    average: finite(row.average),
    ...(includeRange ? { min: finite(row.min), max: finite(row.max) } : {}),
    series: points(row.series),
  };
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

  const brainRow = record(root.brain);
  const brainEventMetric = (value: unknown) => {
    const row = record(value);
    if (!row) return undefined;
    return {
      count: nonNegative(row.count),
      indexPerHour: nonNegative(row.indexPerHour),
      densityPerMinute: nonNegative(row.densityPerMinute),
      series: points(row.series),
    };
  };
  const brain = brainRow
    ? {
        microArousals: brainEventMetric(brainRow.microArousals),
        spindles: brainEventMetric(brainRow.spindles),
        slowOscillations: brainEventMetric(brainRow.slowOscillations),
        slowWaveActivity: metric(brainRow.slowWaveActivity),
      }
    : undefined;

  const environmentRow = record(root.environment);
  const correlations = Array.isArray(environmentRow?.correlations)
    ? environmentRow.correlations
        .map((item) => {
          const row = record(item);
          const factor = text(row?.factor);
          const outcome = text(row?.outcome);
          const coefficient = finite(row?.coefficient);
          const sampleNights = nonNegative(row?.sampleNights);
          if (!factor || !outcome || coefficient == null || sampleNights == null) return null;
          return {
            factor,
            outcome,
            coefficient: Math.max(-1, Math.min(1, coefficient)),
            sampleNights: Math.floor(sampleNights),
          };
        })
        .filter((item): item is NonNullable<typeof item> => item != null)
    : undefined;
  const environment = environmentRow
    ? {
        temperatureC: metric(environmentRow.temperatureC),
        co2Ppm: metric(environmentRow.co2Ppm),
        humidityPercent: metric(environmentRow.humidityPercent),
        correlations: correlations?.length ? correlations : undefined,
      }
    : undefined;

  const circadianRow = record(root.circadian);
  const timingWindows = Array.isArray(circadianRow?.timingWindows)
    ? circadianRow.timingWindows
        .map((item) => {
          const row = record(item);
          const kind = row?.kind;
          const startMs = nonNegative(row?.startMs);
          const endMs = nonNegative(row?.endMs);
          if (
            typeof kind !== 'string' ||
            !WINDOW_KINDS.includes(kind as (typeof WINDOW_KINDS)[number]) ||
            startMs == null ||
            endMs == null ||
            endMs <= startMs
          ) {
            return null;
          }
          return {
            kind: kind as (typeof WINDOW_KINDS)[number],
            startMs,
            endMs,
            label: text(row?.label),
          };
        })
        .filter((item): item is NonNullable<typeof item> => item != null)
    : undefined;
  const chronotype = circadianRow?.chronotype;
  const confidence = finite(circadianRow?.confidence);
  const circadian = circadianRow
    ? {
        estimatedDlmoMs: nonNegative(circadianRow.estimatedDlmoMs),
        uncertaintyMinutes: nonNegative(circadianRow.uncertaintyMinutes),
        phaseOffsetMinutes: finite(circadianRow.phaseOffsetMinutes),
        confidence: confidence == null ? undefined : Math.max(0, Math.min(1, confidence)),
        chronotype:
          typeof chronotype === 'string' && CHRONOTYPES.includes(chronotype as (typeof CHRONOTYPES)[number])
            ? (chronotype as (typeof CHRONOTYPES)[number])
            : undefined,
        timingWindows: timingWindows?.length ? timingWindows : undefined,
      }
    : undefined;

  const closedLoopRow = record(root.closedLoop);
  const interventionEvents = Array.isArray(closedLoopRow?.events)
    ? closedLoopRow.events
        .map((item) => {
          const row = record(item);
          const offsetSec = nonNegative(row?.offsetSec);
          const kind = row?.kind;
          if (
            offsetSec == null ||
            typeof kind !== 'string' ||
            !INTERVENTION_KINDS.includes(kind as (typeof INTERVENTION_KINDS)[number])
          ) {
            return null;
          }
          return {
            offsetSec,
            kind: kind as (typeof INTERVENTION_KINDS)[number],
            responseDeltaPercent: finite(row?.responseDeltaPercent),
          };
        })
        .filter((item): item is NonNullable<typeof item> => item != null)
        .sort((a, b) => a.offsetSec - b.offsetSec)
    : undefined;
  const closedLoop = closedLoopRow
    ? {
        deepSleepStimulations: nonNegative(closedLoopRow.deepSleepStimulations),
        acceptedStimulations: nonNegative(closedLoopRow.acceptedStimulations),
        slowWaveDeltaPercent: finite(closedLoopRow.slowWaveDeltaPercent),
        events: interventionEvents?.length ? interventionEvents : undefined,
      }
    : undefined;

  const qualityRow = record(root.quality);
  const sensorCoverageRow = record(qualityRow?.sensorCoverage);
  const sensorCoverage = sensorCoverageRow
    ? SENSORS.reduce<Partial<Record<InsightSensor, number>>>((result, sensor) => {
        const value = boundedPercent(sensorCoverageRow[sensor]);
        if (value != null) result[sensor] = value;
        return result;
      }, {})
    : undefined;
  const quality = qualityRow
    ? {
        usableSignalPercent: boundedPercent(qualityRow.usableSignalPercent),
        artifactMinutes: nonNegative(qualityRow.artifactMinutes),
        modelVersion: text(qualityRow.modelVersion),
        sensorCoverage: sensorCoverage && Object.keys(sensorCoverage).length ? sensorCoverage : undefined,
      }
    : undefined;

  return {
    schemaVersion,
    motion,
    cardio,
    eyeMovements,
    sound,
    brain,
    environment,
    circadian,
    closedLoop,
    quality,
  };
}
