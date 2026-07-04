import { coverageGaps, formatDrift, formatShiftCount, formatStillest, movementToH, tiltToY } from '../headMovementHelpers';

describe('headMovement helpers', () => {
  test('tiltToY maps zero tilt to the lane center and clamps past the range', () => {
    const laneTop = 20;
    const laneH = 80;
    const maxAbsDeg = 10;

    expect(tiltToY(0, laneTop, laneH, maxAbsDeg)).toBe(60);
    expect(tiltToY(maxAbsDeg, laneTop, laneH, maxAbsDeg)).toBe(laneTop);
    expect(tiltToY(-maxAbsDeg, laneTop, laneH, maxAbsDeg)).toBe(laneTop + laneH);
    expect(tiltToY(maxAbsDeg * 2, laneTop, laneH, maxAbsDeg)).toBe(laneTop);
    expect(tiltToY(-maxAbsDeg * 2, laneTop, laneH, maxAbsDeg)).toBe(laneTop + laneH);
  });

  test('movementToH clamps movement into the lane height', () => {
    const laneH = 72;

    expect(movementToH(0, laneH)).toBe(0);
    expect(movementToH(1, laneH)).toBe(laneH);
    expect(movementToH(1.5, laneH)).toBe(laneH);
  });

  test('coverageGaps merges consecutive zero-coverage head movement epochs', () => {
    expect(
      coverageGaps(
        [
          { startMs: 0, pitch: 0, roll: 0, movement: 0.2, coverage: 1 },
          { startMs: 30_000, pitch: 0, roll: 0, movement: 0.1, coverage: 0 },
          { startMs: 60_000, pitch: 0, roll: 0, movement: 0.15, coverage: 0 },
          { startMs: 90_000, pitch: 0, roll: 0, movement: 0.3, coverage: 1 },
          { startMs: 120_000, pitch: 0, roll: 0, movement: 0.05, coverage: 0 },
        ],
        1_000,
      ),
    ).toEqual([
      { startMs: 31_000, endMs: 91_000 },
      { startMs: 121_000, endMs: 151_000 },
    ]);
  });

  test('formatStillest returns an empty string for absent insight and a readable summary otherwise', () => {
    expect(formatStillest(null)).toBe('');
    expect(formatStillest({ durationMs: 8_040_000, stage: 'deep' })).toBe('Most still during deep sleep - 2h 14m');
  });

  test('formatDrift summarizes the start and end roll values', () => {
    expect(formatDrift(null)).toBe('');
    expect(formatDrift({ startRollDeg: -1.2, endRollDeg: 3.4 })).toBe('Roll drifted from -1.2deg to 3.4deg');
  });

  test('formatShiftCount hides zero and handles singular and plural counts', () => {
    expect(formatShiftCount(0)).toBe('');
    expect(formatShiftCount(1)).toBe('1 shift');
    expect(formatShiftCount(4)).toBe('4 shifts');
  });
});
