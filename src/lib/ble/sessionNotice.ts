export type SessionEndReason = 'device-lost' | 'battery' | 'interrupted';

export type SessionEndNotice = {
  sessionId: string;
  reason: SessionEndReason;
  sessionStartMs: number;
  dataEndMs: number;
  disconnectAtMs: number;
  noticedAtMs: number;
  lastBatteryPct: number | null;
};

export const LOW_BATTERY_HINT_PCT = 20;

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function buildAutoEndNotice(input: {
  sessionId: string;
  reason: 'device-lost' | 'battery';
  sessionStartMs: number;
  dataEndMs: number;
  disconnectAtMs: number | null;
  lastBatteryPct: number | null;
  nowMs: number;
}): SessionEndNotice {
  return {
    sessionId: input.sessionId,
    reason: input.reason,
    sessionStartMs: input.sessionStartMs,
    dataEndMs: input.dataEndMs,
    disconnectAtMs: input.disconnectAtMs ?? input.dataEndMs,
    noticedAtMs: input.nowMs,
    lastBatteryPct: input.lastBatteryPct,
  };
}

export function buildRecoveredNotice(input: {
  sessionId: string;
  sessionStartMs: number;
  dataEndMs: number;
  markerDisconnectAtMs: number | null;
  markerLastBatteryPct: number | null;
  nowMs: number;
}): SessionEndNotice {
  const reason: SessionEndReason =
    input.markerDisconnectAtMs !== null ? 'device-lost' : 'interrupted';

  return {
    sessionId: input.sessionId,
    reason,
    sessionStartMs: input.sessionStartMs,
    dataEndMs: input.dataEndMs,
    disconnectAtMs: input.markerDisconnectAtMs ?? input.dataEndMs,
    noticedAtMs: input.nowMs,
    lastBatteryPct: input.markerLastBatteryPct,
  };
}

export function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, elapsedMs) / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export function noticeLines(
  notice: SessionEndNotice,
  options: { abandonedMs: number; nowMs: number },
): { title: string; lines: string[] } {
  const lines = [reasonLine(notice.reason, options.abandonedMs)];
  const when = fmtWhen(notice.disconnectAtMs, options.nowMs);
  const whenPhrase = notice.reason === 'interrupted' ? `around ${when}` : when;
  const duration = formatElapsed(Math.max(0, notice.dataEndMs - notice.sessionStartMs));

  lines.push(`Disconnected ${whenPhrase} · ${duration} recorded and saved.`);

  if (
    notice.reason === 'device-lost' &&
    notice.lastBatteryPct !== null &&
    notice.lastBatteryPct <= LOW_BATTERY_HINT_PCT
  ) {
    lines.push(
      `Battery was at ${notice.lastBatteryPct}% before it disconnected — it may have run out.`,
    );
  }

  return { title: 'Your night ended early', lines };
}

function reasonLine(reason: SessionEndReason, abandonedMs: number): string {
  switch (reason) {
    case 'device-lost':
      return `Your device disconnected and couldn't reconnect — the app tried for ${Math.round(
        abandonedMs / 60_000,
      )} minutes.`;
    case 'battery':
      return "Your device's battery ran out, so the recording was stopped safely.";
    case 'interrupted':
      return 'The recording was interrupted — the app was closed mid-night.';
  }
}

function fmtWhen(ms: number, nowMs: number): string {
  const at = new Date(ms);
  const now = new Date(nowMs);
  const time = fmtTime(at);

  if (sameCalendarDay(at, now)) return `at ${time}`;

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameCalendarDay(at, yesterday)) return `yesterday at ${time}`;

  return `${DAY_LABELS[at.getDay()]} at ${time}`;
}

function sameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function fmtTime(date: Date): string {
  const hour24 = date.getHours();
  const hour12 = hour24 % 12 || 12;
  const minute = date.getMinutes().toString().padStart(2, '0');
  const suffix = hour24 < 12 ? 'AM' : 'PM';

  return `${hour12}:${minute} ${suffix}`;
}
