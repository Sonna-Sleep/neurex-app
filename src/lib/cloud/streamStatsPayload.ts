import type { StreamStats } from '../ble/types';
import { TIME_GAP_REPORT_THRESHOLD_MS } from '../ble/constants';

export type StreamStatsStopReason =
  | 'manual'
  | 'battery'
  | 'device-lost'
  | 'storage-error'
  | 'recovery';

export type StreamStatsPayloadInput = {
  sessionId: string;
  startedAtMs: number;
  endMs: number;
  stopReason: StreamStatsStopReason;
  stats?: Partial<StreamStats> | null;
  confirmedRawSegmentCount: number | null;
  confirmedImuSegmentCount: number | null;
  appVersion: string;
  appBuild: number | null;
  createdAtMs?: number;
};

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function buildStreamStatsPayload(input: StreamStatsPayloadInput) {
  const stats = input.stats ?? {};
  return {
    schemaVer: 1,
    sessionId: input.sessionId,
    createdAtMs: input.createdAtMs ?? Date.now(),
    startedAtMs: input.startedAtMs,
    endMs: input.endMs,
    durationMs: Math.max(0, input.endMs - input.startedAtMs),
    stopReason: input.stopReason,
    packets: num(stats.packets),
    samples: num(stats.samples),
    drops: num(stats.drops),
    dupSkips: num(stats.dupSkips),
    deviceReboots: num(stats.deviceReboots),
    timeGapCount: num(stats.timeGapCount),
    totalTimeGapMs: num(stats.totalTimeGapMs),
    maxTimeGapMs: num(stats.maxTimeGapMs),
    timeGapThresholdMs: TIME_GAP_REPORT_THRESHOLD_MS,
    lastSeq: stats.lastSeq == null ? null : num(stats.lastSeq),
    generation: num(stats.generation),
    lastBaseMs: stats.lastBaseMs == null ? null : num(stats.lastBaseMs),
    confirmedRawSegmentCount: input.confirmedRawSegmentCount,
    rawRequired: stats.rawRequired ?? null,
    rawOpened: stats.rawOpened ?? null,
    rawBytesWritten: num(stats.rawBytesWritten),
    rawClosed: stats.rawClosed ?? null,
    rawUploaded: stats.rawUploaded ?? null,
    rawSha256: typeof stats.rawSha256 === 'string' ? stats.rawSha256 : null,
    rawFailureReason:
      typeof stats.rawFailureReason === 'string' ? stats.rawFailureReason : null,
    confirmedImuSegmentCount: input.confirmedImuSegmentCount,
    imuAvailable: stats.imuAvailable ?? null,
    imuOpened: stats.imuOpened ?? null,
    imuNotifications: num(stats.imuNotifications),
    imuBytesWritten: num(stats.imuBytesWritten),
    imuClosed: stats.imuClosed ?? null,
    imuUploaded: stats.imuUploaded ?? null,
    imuSha256: typeof stats.imuSha256 === 'string' ? stats.imuSha256 : null,
    imuFailureReason:
      typeof stats.imuFailureReason === 'string' ? stats.imuFailureReason : null,
    appVersion: input.appVersion,
    appBuild: input.appBuild,
  };
}
