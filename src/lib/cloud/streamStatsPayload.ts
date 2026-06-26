import type { StreamStats } from '../ble/types';

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
  chunkedUploadEnabled: boolean;
  chunkSeconds: number;
  queuedChunkCount: number;
  confirmedChunkCount: number | null;
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
    lastSeq: stats.lastSeq == null ? null : num(stats.lastSeq),
    generation: num(stats.generation),
    lastBaseMs: stats.lastBaseMs == null ? null : num(stats.lastBaseMs),
    chunkedUploadEnabled: input.chunkedUploadEnabled,
    chunkSeconds: input.chunkSeconds,
    queuedChunkCount: input.queuedChunkCount,
    confirmedChunkCount: input.confirmedChunkCount,
    appVersion: input.appVersion,
    appBuild: input.appBuild,
  };
}
