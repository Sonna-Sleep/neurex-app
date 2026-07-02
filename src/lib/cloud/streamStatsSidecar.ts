import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import appConfig from '../../../app.json';

import { getSupabase } from '../auth/supabase';
import type { StreamStats } from '../ble/types';
import {
  buildStreamStatsPayload,
  type StreamStatsStopReason,
} from './streamStatsPayload';

export type { StreamStatsStopReason } from './streamStatsPayload';

const STREAM_STATS_NAME = 'stream_stats.json';
const RECORDINGS_BUCKET = 'recordings';

export type WriteStreamStatsInput = {
  sessionId: string;
  startedAtMs: number;
  endMs: number;
  stopReason: StreamStatsStopReason;
  stats?: Partial<StreamStats> | null;
  prefix?: string | null;
};

function sessionDir(sessionId: string): Directory {
  return new Directory(Paths.document, 'sessions', sessionId);
}

export function streamStatsFile(sessionId: string): File {
  return new File(sessionDir(sessionId), STREAM_STATS_NAME);
}

function appBuild(): number | null {
  if (Platform.OS === 'ios') {
    const b = (appConfig.expo as { ios?: { buildNumber?: string } }).ios?.buildNumber;
    const n = b == null ? NaN : Number(b);
    return Number.isFinite(n) ? n : null;
  }
  return appConfig.expo.android?.versionCode ?? null;
}

async function confirmedRawSegmentCount(prefix?: string | null): Promise<number | null> {
  if (!prefix) return null;
  const supabase = getSupabase();
  if (!supabase) return null;
  const dir = `${prefix}/segments/raw`;
  let total = 0;
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.storage
      .from(RECORDINGS_BUCKET)
      .list(dir, { limit: pageSize, offset });
    if (error || !data) return null;
    total += data.filter((item) => /^seg\d{4}\.bin$/.test(item.name)).length;
    if (data.length < pageSize) return total;
  }
}

function readExisting(file: File): Record<string, unknown> | null {
  try {
    if (!file.exists) return null;
    const parsed = JSON.parse(file.textSync());
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeJson(sessionId: string, file: File, payload: unknown): void {
  const dir = sessionDir(sessionId);
  if (!dir.exists) dir.create({ intermediates: true });
  if (!file.exists) file.create();
  file.write(JSON.stringify(payload));
}

export async function writeStreamStatsSidecar(input: WriteStreamStatsInput): Promise<void> {
  const file = streamStatsFile(input.sessionId);
  const payload = buildStreamStatsPayload({
    sessionId: input.sessionId,
    startedAtMs: input.startedAtMs,
    endMs: input.endMs,
    stopReason: input.stopReason,
    stats: input.stats,
    confirmedRawSegmentCount: await confirmedRawSegmentCount(input.prefix),
    appVersion: appConfig.expo.version,
    appBuild: appBuild(),
  });
  writeJson(input.sessionId, file, payload);
}

export async function ensureStreamStatsSidecar(input: WriteStreamStatsInput): Promise<void> {
  const file = streamStatsFile(input.sessionId);
  if (file.exists) return;
  await writeStreamStatsSidecar(input);
}

export async function refreshStreamStatsSidecarUploadCounts(
  sessionId: string,
  prefix: string,
  raw?: { rawSha256?: string | null; rawUploaded?: boolean },
): Promise<void> {
  const file = streamStatsFile(sessionId);
  const existing = readExisting(file);
  if (!existing) return;
  writeJson(sessionId, file, {
    ...existing,
    confirmedRawSegmentCount: await confirmedRawSegmentCount(prefix),
    ...(raw?.rawUploaded !== undefined ? { rawUploaded: raw.rawUploaded } : {}),
    ...(raw?.rawSha256 ? { rawSha256: raw.rawSha256 } : {}),
  });
}
