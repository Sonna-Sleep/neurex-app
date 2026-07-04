import { rawTiltExtent } from '../headMovementHelpers';
import { axisTicks, headMovementChartEndMs } from '../timelineScale';

describe('timeline scale helpers', () => {
  test('exports head-movement chart end helper with 30-second bin semantics', () => {
    expect(
      headMovementChartEndMs(
        [
          { startMs: 0, pitch: 0, roll: 0, movement: 0.1, coverage: 1 },
          { startMs: 30_000, pitch: 0.5, roll: -0.25, movement: 0.2, coverage: 1 },
        ],
        1_000,
        8 * 60 * 60 * 1000,
      ),
    ).toBe(61_000);
  });

  test('exports shared two-hour axis ticks', () => {
    const startMs = new Date(2026, 0, 1, 21, 15).getTime();
    const endMs = new Date(2026, 0, 2, 3, 0).getTime();

    expect(axisTicks(startMs, endMs)).toEqual([
      { ms: new Date(2026, 0, 1, 22, 0).getTime(), label: '10 PM' },
      { ms: new Date(2026, 0, 2, 0, 0).getTime(), label: '12 AM' },
      { ms: new Date(2026, 0, 2, 2, 0).getTime(), label: '2 AM' },
    ]);
  });
});

describe('head movement helpers', () => {
  test('uses raw baseline-relative tilt values when computing extent', () => {
    expect(
      rawTiltExtent([
        { startMs: 0, pitch: 1.5, roll: -2.25, movement: 0.1, coverage: 1 },
        { startMs: 30_000, pitch: -4, roll: 0.75, movement: 0.3, coverage: 1 },
      ]),
    ).toBe(4);
  });
});
