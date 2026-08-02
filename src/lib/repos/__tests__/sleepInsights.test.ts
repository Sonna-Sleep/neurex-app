import { normalizeSleepInsights } from '../sleepInsights';

describe('normalizeSleepInsights', () => {
  it('accepts partial future insight payloads and sorts time-series data', () => {
    expect(
      normalizeSleepInsights({
        schemaVersion: 1,
        cardio: {
          heartRateBpm: {
            average: 58,
            series: [
              { offsetSec: 120, value: 61 },
              { offsetSec: 0, value: 57 },
            ],
          },
        },
        motion: {
          turns: 8,
          positions: [{ startSec: 0, durationSec: 600, position: 'left', quality: 108 }],
        },
      }),
    ).toMatchObject({
      schemaVersion: 1,
      cardio: {
        heartRateBpm: {
          average: 58,
          series: [
            { offsetSec: 0, value: 57 },
            { offsetSec: 120, value: 61 },
          ],
        },
      },
      motion: {
        turns: 8,
        positions: [{ startSec: 0, durationSec: 600, position: 'left', quality: 100 }],
      },
    });
  });

  it('drops malformed sensor readings instead of exposing them to charts', () => {
    const result = normalizeSleepInsights({
      cardio: {
        heartRateBpm: {
          series: [
            { offsetSec: -1, value: 70 },
            { offsetSec: 10, value: 'bad' },
          ],
        },
      },
      motion: {
        positions: [{ startSec: 0, durationSec: 100, position: 'ceiling' }],
      },
    });

    expect(result?.cardio?.heartRateBpm?.series).toBeUndefined();
    expect(result?.motion?.positions).toBeUndefined();
  });

  it('normalizes experimental brain, environment, circadian, intervention, and quality data', () => {
    const result = normalizeSleepInsights({
      brain: {
        microArousals: { count: 12, indexPerHour: 1.7 },
        spindles: { densityPerMinute: 2.8 },
      },
      environment: {
        temperatureC: { average: 19.4 },
        correlations: [
          { factor: 'Room temperature', outcome: 'Deep sleep', coefficient: 1.4, sampleNights: 12.9 },
          { factor: '', outcome: 'Sleep', coefficient: 0.2, sampleNights: 8 },
        ],
      },
      circadian: {
        estimatedDlmoMs: 1_785_472_200_000,
        confidence: 1.4,
        chronotype: 'late',
        timingWindows: [
          { kind: 'morningLight', startMs: 1_785_500_000_000, endMs: 1_785_503_600_000 },
          { kind: 'nap', startMs: 10, endMs: 20 },
        ],
      },
      closedLoop: {
        deepSleepStimulations: 18,
        events: [
          { offsetSec: 200, kind: 'pinkNoise', responseDeltaPercent: 4.2 },
          { offsetSec: 10, kind: 'invalid' },
        ],
      },
      quality: {
        usableSignalPercent: 104,
        modelVersion: ' staging-v3 ',
        sensorCoverage: { eeg: 97, ppg: -3, audio: 72 },
      },
    });

    expect(result).toMatchObject({
      brain: { microArousals: { count: 12, indexPerHour: 1.7 }, spindles: { densityPerMinute: 2.8 } },
      environment: {
        temperatureC: { average: 19.4 },
        correlations: [{ factor: 'Room temperature', outcome: 'Deep sleep', coefficient: 1, sampleNights: 12 }],
      },
      circadian: {
        confidence: 1,
        chronotype: 'late',
        timingWindows: [{ kind: 'morningLight' }],
      },
      closedLoop: {
        deepSleepStimulations: 18,
        events: [{ offsetSec: 200, kind: 'pinkNoise', responseDeltaPercent: 4.2 }],
      },
      quality: {
        usableSignalPercent: 100,
        modelVersion: 'staging-v3',
        sensorCoverage: { eeg: 97, audio: 72 },
      },
    });
  });

  it('returns null for non-object cloud values', () => {
    expect(normalizeSleepInsights(null)).toBeNull();
    expect(normalizeSleepInsights('not-json')).toBeNull();
  });
});
