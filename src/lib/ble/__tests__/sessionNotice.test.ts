import {
  LOW_BATTERY_HINT_PCT,
  buildAutoEndNotice,
  buildRecoveredNotice,
  formatElapsed,
  noticeLines,
  type SessionEndNotice,
} from '../sessionNotice';

const localMs = (
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
) => new Date(year, monthIndex, day, hour, minute, second).getTime();

const baseNotice: SessionEndNotice = {
  sessionId: 'session-1',
  reason: 'device-lost',
  sessionStartMs: localMs(2026, 6, 3, 1, 0),
  dataEndMs: localMs(2026, 6, 3, 3, 12),
  disconnectAtMs: localMs(2026, 6, 3, 3, 12),
  noticedAtMs: localMs(2026, 6, 3, 3, 20),
  lastBatteryPct: null,
};

describe('session end notices', () => {
  test.each([
    {
      markerDisconnectAtMs: localMs(2026, 6, 3, 3, 12),
      markerLastBatteryPct: 18,
      expectedReason: 'device-lost' as const,
      expectedDisconnectAtMs: localMs(2026, 6, 3, 3, 12),
      expectedBatteryPct: 18,
    },
    {
      markerDisconnectAtMs: null,
      markerLastBatteryPct: null,
      expectedReason: 'interrupted' as const,
      expectedDisconnectAtMs: localMs(2026, 6, 3, 3, 30),
      expectedBatteryPct: null,
    },
  ])(
    'buildRecoveredNotice selects $expectedReason when markerDisconnectAtMs is $markerDisconnectAtMs',
    ({ markerDisconnectAtMs, markerLastBatteryPct, expectedReason, expectedDisconnectAtMs, expectedBatteryPct }) => {
      const notice = buildRecoveredNotice({
        sessionId: 'session-1',
        sessionStartMs: localMs(2026, 6, 3, 1, 0),
        dataEndMs: localMs(2026, 6, 3, 3, 30),
        markerDisconnectAtMs,
        markerLastBatteryPct,
        nowMs: localMs(2026, 6, 3, 4, 0),
      });

      expect(notice).toMatchObject({
        sessionId: 'session-1',
        reason: expectedReason,
        sessionStartMs: localMs(2026, 6, 3, 1, 0),
        dataEndMs: localMs(2026, 6, 3, 3, 30),
        disconnectAtMs: expectedDisconnectAtMs,
        noticedAtMs: localMs(2026, 6, 3, 4, 0),
        lastBatteryPct: expectedBatteryPct,
      });
    },
  );

  test.each([
    {
      name: 'buildAutoEndNotice uses the explicit disconnect timestamp',
      build: () =>
        buildAutoEndNotice({
          sessionId: 'session-1',
          reason: 'device-lost',
          sessionStartMs: 1_000,
          dataEndMs: 5_000,
          disconnectAtMs: 4_000,
          lastBatteryPct: 30,
          nowMs: 6_000,
        }),
      expectedDisconnectAtMs: 4_000,
    },
    {
      name: 'buildAutoEndNotice falls back to dataEndMs',
      build: () =>
        buildAutoEndNotice({
          sessionId: 'session-1',
          reason: 'battery',
          sessionStartMs: 1_000,
          dataEndMs: 5_000,
          disconnectAtMs: null,
          lastBatteryPct: 0,
          nowMs: 6_000,
        }),
      expectedDisconnectAtMs: 5_000,
    },
    {
      name: 'buildRecoveredNotice uses the marker disconnect timestamp',
      build: () =>
        buildRecoveredNotice({
          sessionId: 'session-1',
          sessionStartMs: 1_000,
          dataEndMs: 5_000,
          markerDisconnectAtMs: 4_000,
          markerLastBatteryPct: 30,
          nowMs: 6_000,
        }),
      expectedDisconnectAtMs: 4_000,
    },
    {
      name: 'buildRecoveredNotice falls back to dataEndMs',
      build: () =>
        buildRecoveredNotice({
          sessionId: 'session-1',
          sessionStartMs: 1_000,
          dataEndMs: 5_000,
          markerDisconnectAtMs: null,
          markerLastBatteryPct: null,
          nowMs: 6_000,
        }),
      expectedDisconnectAtMs: 5_000,
    },
  ])('$name', ({ build, expectedDisconnectAtMs }) => {
    expect(build().disconnectAtMs).toBe(expectedDisconnectAtMs);
  });

  test.each([
    {
      lastBatteryPct: LOW_BATTERY_HINT_PCT,
      expectedHint: `Battery was at ${LOW_BATTERY_HINT_PCT}% before it disconnected — it may have run out.`,
    },
    {
      lastBatteryPct: LOW_BATTERY_HINT_PCT + 1,
      expectedHint: null,
    },
    {
      lastBatteryPct: null,
      expectedHint: null,
    },
  ])('noticeLines battery hint for lastBatteryPct=$lastBatteryPct', ({ lastBatteryPct, expectedHint }) => {
    const notice = { ...baseNotice, lastBatteryPct };
    const { lines } = noticeLines(notice, {
      abandonedMs: 10 * 60_000,
      nowMs: localMs(2026, 6, 3, 9, 0),
    });

    if (expectedHint) {
      expect(lines).toContain(expectedHint);
    } else {
      expect(lines).not.toContain(
        expect.stringContaining('before it disconnected — it may have run out.'),
      );
    }
  });

  test.each([
    [0, '0s'],
    [59_000, '59s'],
    [59 * 60_000 + 59_000, '59m 59s'],
    [1 * 60 * 60_000 + 2 * 60_000 + 3_000, '1h 2m 3s'],
  ])('formatElapsed(%i) returns %s', (elapsedMs, expected) => {
    expect(formatElapsed(elapsedMs)).toBe(expected);
  });

  test.each([
    {
      reason: 'device-lost' as const,
      abandonedMs: 14 * 60_000 + 31_000,
      expectedFirstLine:
        "Your device disconnected and couldn't reconnect — the app tried for 15 minutes.",
    },
    {
      reason: 'battery' as const,
      abandonedMs: 0,
      expectedFirstLine: "Your device's battery ran out, so the recording was stopped safely.",
    },
    {
      reason: 'interrupted' as const,
      abandonedMs: 0,
      expectedFirstLine: 'The recording was interrupted — the app was closed mid-night.',
    },
  ])('noticeLines copy for $reason', ({ reason, abandonedMs, expectedFirstLine }) => {
    const { title, lines } = noticeLines({ ...baseNotice, reason }, {
      abandonedMs,
      nowMs: localMs(2026, 6, 3, 9, 0),
    });

    expect(title).toBe('Your night ended early');
    expect(lines[0]).toBe(expectedFirstLine);
  });

  test.each([
    {
      name: 'same day',
      notice: {
        ...baseNotice,
        sessionStartMs: localMs(2026, 6, 3, 1, 0),
        dataEndMs: localMs(2026, 6, 3, 3, 12),
        disconnectAtMs: localMs(2026, 6, 3, 3, 12),
      },
      nowMs: localMs(2026, 6, 3, 9, 0),
      expectedLine: 'Disconnected at 3:12 AM · 2h 12m 0s recorded and saved.',
    },
    {
      name: 'previous day across midnight',
      notice: {
        ...baseNotice,
        sessionStartMs: localMs(2026, 6, 3, 22, 30),
        dataEndMs: localMs(2026, 6, 3, 23, 55),
        disconnectAtMs: localMs(2026, 6, 3, 23, 55),
      },
      nowMs: localMs(2026, 6, 4, 0, 30),
      expectedLine: 'Disconnected yesterday at 11:55 PM · 1h 25m 0s recorded and saved.',
    },
    {
      name: 'earlier calendar day',
      notice: {
        ...baseNotice,
        sessionStartMs: localMs(2026, 6, 6, 2, 55),
        dataEndMs: localMs(2026, 6, 6, 3, 12),
        disconnectAtMs: localMs(2026, 6, 6, 3, 12),
      },
      nowMs: localMs(2026, 6, 9, 10, 0),
      expectedLine: 'Disconnected Mon at 3:12 AM · 17m 0s recorded and saved.',
    },
    {
      name: 'interrupted prefixes around',
      notice: {
        ...baseNotice,
        reason: 'interrupted' as const,
        sessionStartMs: localMs(2026, 6, 3, 1, 0),
        dataEndMs: localMs(2026, 6, 3, 3, 12),
        disconnectAtMs: localMs(2026, 6, 3, 3, 12),
      },
      nowMs: localMs(2026, 6, 3, 9, 0),
      expectedLine: 'Disconnected around at 3:12 AM · 2h 12m 0s recorded and saved.',
    },
    {
      name: 'duration clamps negative spans',
      notice: {
        ...baseNotice,
        sessionStartMs: localMs(2026, 6, 3, 3, 12),
        dataEndMs: localMs(2026, 6, 3, 3, 0),
        disconnectAtMs: localMs(2026, 6, 3, 3, 0),
      },
      nowMs: localMs(2026, 6, 3, 9, 0),
      expectedLine: 'Disconnected at 3:00 AM · 0s recorded and saved.',
    },
  ])('noticeLines formats when and duration for $name', ({ notice, nowMs, expectedLine }) => {
    expect(noticeLines(notice, { abandonedMs: 0, nowMs }).lines[1]).toBe(expectedLine);
  });
});
