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

  it('returns null for non-object cloud values', () => {
    expect(normalizeSleepInsights(null)).toBeNull();
    expect(normalizeSleepInsights('not-json')).toBeNull();
  });
});
